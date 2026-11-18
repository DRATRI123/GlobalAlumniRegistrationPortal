/**
 * Registration.gs
 * ---------------------------------------------------------------------------
 * Public registration flow:
 *   validate → idempotency check → duplicate check → save photo →
 *   [LOCK] re-check duplicates, generate ID, append row, update summaries [UNLOCK]
 *   → confirmation email.
 */

/**
 * Duplicate rules (documented in docs/TESTING.md):
 *   HARD duplicate (rejected) – same normalised full name AND any of:
 *       same mobile, same email, or same admission + leaving year.
 *   SOFT duplicate (accepted, flagged for admins) – same mobile or same email
 *       but a different name (e.g. siblings sharing a family number).
 * @return {{hard:Array<string>, softIds:Array<string>}}
 */
function findDuplicates_(data, excludeId) {
  const rows = readMasterColumns_(['registrationId', 'fullName', 'admissionYear', 'leavingYear', 'mobile', 'email']);
  const name = normaliseName_(data.fullName);
  const hard = {};
  const soft = [];
  rows.forEach(function (r) {
    if (excludeId && r.registrationId === excludeId) return;
    const sameMobile = data.mobile && r.mobile === data.mobile;
    const sameEmail = data.email && r.email.toLowerCase() === data.email;
    const sameName = normaliseName_(r.fullName) === name;
    if (sameName) {
      if (sameMobile) hard.mobile = true;
      if (sameEmail) hard.email = true;
      if (String(r.admissionYear) === String(data.admissionYear) && String(r.leavingYear) === String(data.leavingYear)) hard.nameBatch = true;
    } else if (sameMobile || sameEmail) {
      soft.push(r.registrationId);
    }
  });
  return { hard: Object.keys(hard), softIds: soft };
}

/** Generates the next ALM-2028-000001 style ID. Caller MUST hold the script lock. */
function nextRegistrationId_() {
  const p = props_();
  const raw = p.getProperty(PROP.REG_SEQ);
  let seq = raw ? Number(raw) : highestExistingSequence_();
  if (!isFinite(seq) || seq < 0) seq = highestExistingSequence_();
  seq += 1;
  p.setProperty(PROP.REG_SEQ, String(seq));
  return APP.ID_PREFIX + ('000000000' + seq).slice(-APP.ID_PAD);
}

function highestExistingSequence_() {
  let max = 0;
  readMasterColumns_(['registrationId']).forEach(function (r) {
    const m = /-(\d+)$/.exec(r.registrationId);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return max;
}

function maxPhotoBytes_() {
  const mb = Math.min(5, Math.max(1, Number(getSettings_().MAX_PHOTO_MB) || APP.MAX_PHOTO_MB_DEFAULT));
  return mb * 1024 * 1024;
}

/** Main entry (wrapped by submitRegistration in Code.gs). */
function submitRegistration_(payload) {
  if (!settingTrue_('REGISTRATION_OPEN')) return { ok: false, code: 'CLOSED' };
  if (!payload || typeof payload !== 'object') return { ok: false, code: 'VALIDATION', errors: { _form: 'invalid' } };

  const token = String(payload.submissionToken || '');
  if (!RE_TOKEN.test(token)) return { ok: false, code: 'VALIDATION', errors: { _form: 'invalid' } };

  // Honeypot: real users never fill this hidden field.
  if (payload.hp) {
    logActivity_('REGISTER', '', 'public', 'REJECTED_SPAM', 'honeypot', token);
    return { ok: false, code: 'VALIDATION', errors: { _form: 'invalid' } };
  }

  const cache = CacheService.getScriptCache();
  const tokenKey = 'sub_' + token;
  const previous = cache.get(tokenKey);
  if (previous) return { ok: true, registrationId: previous, repeated: true };

  const v = validateRegistration_(payload, { mode: 'public', maxPhotoBytes: maxPhotoBytes_() });
  if (!v.ok) {
    logActivity_('REGISTER', '', 'public', 'VALIDATION_FAILED', Object.keys(v.errors).join(','), token);
    return { ok: false, code: 'VALIDATION', errors: v.errors };
  }
  const data = v.data;

  // Cheap pre-check outside the lock so most duplicates never upload a photo.
  let dup = findDuplicates_(data);
  if (dup.hard.length) {
    logActivity_('REGISTER', '', 'public', 'DUPLICATE_REJECTED', dup.hard.join(','), token);
    return { ok: false, code: 'DUPLICATE', fields: dup.hard };
  }

  let photoId = '';
  if (v.photo && data.consentPhoto) photoId = savePhoto_(v.photo, 'pending_' + token);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(APP.LOCK_TIMEOUT_MS)) {
    if (photoId) trashFile_(photoId);
    return { ok: false, code: 'BUSY' };
  }
  let rec;
  try {
    const again = cache.get(tokenKey);
    if (again) { if (photoId) trashFile_(photoId); return { ok: true, registrationId: again, repeated: true }; }

    dup = findDuplicates_(data);
    if (dup.hard.length) {
      if (photoId) trashFile_(photoId);
      logActivity_('REGISTER', '', 'public', 'DUPLICATE_REJECTED', dup.hard.join(','), token);
      return { ok: false, code: 'DUPLICATE', fields: dup.hard };
    }

    const now = new Date();
    rec = Object.assign({}, data, {
      timestamp: now,
      registrationId: nextRegistrationId_(),
      status: 'ACTIVE',
      photoFileId: photoId,
      consentTimestamp: now,
      privacyVersion: APP.PRIVACY_VERSION,
      moderation: data.consentDirectory ? 'PENDING' : 'NOT_CONSENTED',
      possibleDuplicateOf: dup.softIds.slice(0, 5).join(', '),
      adminNotes: '',
      lastUpdated: now,
      updatedBy: 'self-registration'
    });
    appendMasterRecord_(rec);
    applySummaryDelta_(rec, 1);
    SpreadsheetApp.flush();
    cache.put(tokenKey, rec.registrationId, APP.SUBMISSION_TOKEN_TTL);
  } finally {
    lock.releaseLock();
  }

  logActivity_('REGISTER', rec.registrationId, 'public', 'SUCCESS',
    { country: rec.countryCode, batch: rec.leavingYear, softDuplicate: rec.possibleDuplicateOf || undefined }, token);
  invalidateDataCaches_();
  if (photoId) renameFile_(photoId, rec.registrationId + '.' + v.photo.ext);

  const emailSent = sendConfirmationEmail_(rec);
  return { ok: true, registrationId: rec.registrationId, emailSent: emailSent };
}

/* ------------------------------------------------------ confirmation email */

/** Email copy lives server-side so the public cannot inject email content. */
const EMAIL_TEXT = Object.freeze({
  gu: {
    subject: 'શતાબ્દી 2028 – આપની નોંધણી સફળ: ',
    greeting: 'પ્રિય ',
    body: 'તમારી માહિતી સફળતાપૂર્વક નોંધાઈ ગઈ છે. શાળાના 100 વર્ષના ઐતિહાસિક ઉત્સવ સાથે જોડાવા બદલ આપનો આભાર.',
    idLabel: 'આપનો એલ્યુમની નોંધણી નંબર',
    keep: 'કૃપા કરીને આ નંબર સાચવી રાખો. શાળા સાથેના ભાવિ પત્રવ્યવહારમાં તેનો ઉલ્લેખ કરો.',
    footer: 'આ ઈમેલ આપે આપેલી સંમતિના આધારે મોકલવામાં આવ્યો છે. આપની માહિતી ફક્ત શાળાના એલ્યુમની કાર્ય માટે જ ઉપયોગમાં લેવાશે.'
  },
  hi: {
    subject: 'शताब्दी 2028 – आपका पंजीकरण सफल: ',
    greeting: 'प्रिय ',
    body: 'आपकी जानकारी सफलतापूर्वक दर्ज हो गई है। विद्यालय के 100 वर्षों के ऐतिहासिक उत्सव से जुड़ने के लिए आपका धन्यवाद।',
    idLabel: 'आपकी पूर्व छात्र पंजीकरण संख्या',
    keep: 'कृपया यह संख्या सुरक्षित रखें। विद्यालय के साथ भविष्य के पत्राचार में इसका उल्लेख करें।',
    footer: 'यह ईमेल आपकी दी गई सहमति के आधार पर भेजा गया है। आपकी जानकारी केवल विद्यालय के पूर्व छात्र कार्य के लिए उपयोग की जाएगी।'
  }
});

function escapeHtml_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** @return {boolean} whether an email was sent. Never throws. */
function sendConfirmationEmail_(rec) {
  try {
    if (!settingTrue_('SEND_CONFIRMATION_EMAIL') || !rec.email || !rec.consentContact) return false;
    if (MailApp.getRemainingDailyQuota() < 1) {
      logActivity_('EMAIL', rec.registrationId, 'system', 'SKIPPED_QUOTA', '');
      return false;
    }
    const t = EMAIL_TEXT[rec.language] || EMAIL_TEXT.gu;
    const s = getSettings_();
    const school = rec.language === 'hi' ? s.SCHOOL_NAME_HI : s.SCHOOL_NAME_GU;
    const html =
      '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #e6dcc4;border-radius:12px;overflow:hidden">' +
      '<div style="background:#7a1f2b;color:#fff;padding:20px 24px"><div style="font-size:13px;letter-spacing:2px;color:#e9c97a">1928 – 2028</div>' +
      '<div style="font-size:20px;font-weight:bold">' + escapeHtml_(school) + '</div></div>' +
      '<div style="padding:24px;color:#1f2f56;background:#fffdf7">' +
      '<p>' + t.greeting + escapeHtml_(rec.fullName) + ',</p><p>' + t.body + '</p>' +
      '<p style="margin:24px 0;padding:16px;border:2px dashed #b08d3c;border-radius:8px;text-align:center">' +
      '<span style="font-size:13px">' + t.idLabel + '</span><br><b style="font-size:24px;letter-spacing:1px">' +
      escapeHtml_(rec.registrationId) + '</b></p><p>' + t.keep + '</p>' +
      '<p style="font-size:12px;color:#6b6b6b;margin-top:24px">' + t.footer + '</p></div></div>';
    MailApp.sendEmail({
      to: rec.email,
      subject: t.subject + rec.registrationId,
      htmlBody: html,
      body: t.greeting + rec.fullName + ',\n\n' + t.body + '\n\n' + t.idLabel + ': ' + rec.registrationId + '\n\n' + t.keep,
      name: s.SCHOOL_NAME_EN || APP.NAME,
      replyTo: /@/.test(s.CONTACT_EMAIL) ? s.CONTACT_EMAIL : undefined
    });
    logActivity_('EMAIL', rec.registrationId, 'system', 'SENT', '');
    return true;
  } catch (err) {
    console.error('sendConfirmationEmail_: ' + err);
    logActivity_('EMAIL', rec.registrationId, 'system', 'FAILED', String(err));
    return false;
  }
}
