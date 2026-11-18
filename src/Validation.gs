/**
 * Validation.gs
 * ---------------------------------------------------------------------------
 * Server-side validation and sanitisation. The browser performs the same
 * checks for usability, but ONLY these server checks are trusted.
 *
 * Errors are returned as machine codes (e.g. "required", "invalid") which the
 * frontend translates through the central dictionary – no UI text here.
 */

const RE_NAME = /^[\p{L}\p{M}][\p{L}\p{M}\s.'’\-]*$/u;
const RE_EMAIL = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
const RE_URL = /^https?:\/\/[^\s<>"'`]+\.[^\s<>"'`]{2,}$/i;
const RE_POSTAL = /^[A-Za-z0-9][A-Za-z0-9 \-]{1,11}$/;
const RE_DIVISION = /^[\p{L}\p{M}\p{N} \-]{1,10}$/u;
const RE_LC = /^[\p{L}\p{M}\p{N} \/.\-]{1,30}$/u;
const RE_TOKEN = /^[A-Za-z0-9\-]{16,64}$/;

/** Removes control characters (keeps ZWJ/ZWNJ needed by Indic scripts). */
function cleanText_(v, multiline) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  try { s = s.normalize('NFC'); } catch (e) { /* ignore */ }
  s = s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/g, '');
  if (multiline) {
    s = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  } else {
    s = s.replace(/\s+/g, ' ');
  }
  return s.trim();
}

function currentYear_() {
  return Number(Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy'));
}

/**
 * Builds an E.164 number from a country ISO code + national number.
 * @return {{value:string}|{error:string}}
 */
function normalisePhone_(iso, raw) {
  const country = getCountryMap_()[String(iso || '').toUpperCase()];
  if (!country) return { error: 'phoneInvalid' };
  let digits = String(raw || '').replace(/[\s().\-]/g, '');
  if (digits.indexOf('+') === 0) {
    digits = digits.slice(1);
    if (digits.indexOf(country.dial) === 0) digits = digits.slice(country.dial.length);
    else return { error: 'phoneInvalid' };
  } else if (digits.indexOf('00' + country.dial) === 0 && digits.length > 11) {
    digits = digits.slice(2 + country.dial.length);
  }
  if (!/^\d+$/.test(digits)) return { error: 'phoneInvalid' };
  if (country.dial === '91') {
    digits = digits.replace(/^0+/, '');
    if (!/^[6-9]\d{9}$/.test(digits)) return { error: 'phoneInvalid' };
  } else if (iso !== 'IT') {
    digits = digits.replace(/^0+/, '');
  }
  const full = country.dial + digits;
  if (digits.length < 4 || digits.length > 14 || full.length > 15 || full.length < 7) return { error: 'phoneInvalid' };
  return { value: '+' + full };
}

/** Validates an already-formatted E.164 string (admin edits). */
function normaliseE164_(raw) {
  const s = String(raw || '').replace(/[\s().\-]/g, '');
  if (!/^\+[1-9]\d{6,14}$/.test(s)) return { error: 'phoneInvalid' };
  if (s.indexOf('+91') === 0 && !/^\+91[6-9]\d{9}$/.test(s)) return { error: 'phoneInvalid' };
  return { value: s };
}

function isYes_(v) { return v === true || v === 'true' || v === 'YES' || v === 'on' || v === 1; }

/**
 * Validates a registration payload.
 * @param {Object} p raw payload from the browser
 * @param {{mode:'public'|'admin', maxPhotoBytes:number}} opts
 * @return {{ok:boolean, data:Object, errors:Object, photo:Object|null}}
 */
function validateRegistration_(p, opts) {
  opts = opts || {};
  const mode = opts.mode || 'public';
  const errors = {};
  const data = {};
  p = p && typeof p === 'object' ? p : {};

  const text = function (key, o) {
    const v = cleanText_(p[key], o.multiline);
    if (!v) { if (o.required) errors[key] = 'required'; data[key] = ''; return ''; }
    if (v.length > o.max) { errors[key] = 'tooLong'; }
    else if (o.re && !o.re.test(v)) { errors[key] = 'invalid'; }
    data[key] = v;
    return v;
  };
  const choice = function (key, list, required) {
    const v = String(p[key] === null || p[key] === undefined ? '' : p[key]).trim();
    if (!v) { if (required) errors[key] = 'required'; data[key] = ''; return ''; }
    if (list.indexOf(v) === -1) errors[key] = 'invalid';
    data[key] = v;
    return v;
  };
  const phone = function (key, required) {
    const iso = p[key + 'Country'];
    const num = p[key + 'Number'];
    const hasSplit = num !== undefined && num !== null && String(num).trim() !== '';
    const combined = p[key] !== undefined && p[key] !== null && String(p[key]).trim() !== '';
    if (!hasSplit && !combined) { if (required) errors[key] = 'required'; data[key] = ''; return; }
    const r = hasSplit ? normalisePhone_(iso, num) : normaliseE164_(p[key]);
    if (r.error) errors[key] = r.error; else data[key] = r.value;
    if (data[key] === undefined) data[key] = '';
  };
  const year = function (key) {
    const s = String(p[key] === null || p[key] === undefined ? '' : p[key]).trim();
    if (!s) { errors[key] = 'required'; data[key] = ''; return NaN; }
    const y = Number(s);
    if (!/^\d{4}$/.test(s) || y < APP.FOUNDING_YEAR || y > currentYear_()) { errors[key] = 'invalid'; data[key] = ''; return NaN; }
    data[key] = y;
    return y;
  };

  // Step 1 – personal
  text('fullName', { required: true, max: 100, re: RE_NAME });
  if (data.fullName && data.fullName.length < 2 && !errors.fullName) errors.fullName = 'invalid';
  choice('gender', OPTIONS.GENDER, true);
  const dob = cleanText_(p.dob);
  data.dob = '';
  if (dob) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
    const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
    if (!d || d.getMonth() !== Number(m[2]) - 1 || d.getFullYear() < 1900 || d > new Date()) errors.dob = 'invalid';
    else data.dob = dob;
  }
  text('fatherName', { max: 100, re: RE_NAME });

  // Step 2 – school
  const adm = year('admissionYear');
  const leave = year('leavingYear');
  if (!isNaN(adm) && !isNaN(leave)) {
    if (leave < adm) errors.leavingYear = 'yearOrder';
    else if (leave - adm > 15) errors.leavingYear = 'yearRange';
  }
  choice('lastStandard', OPTIONS.STANDARDS, true);
  text('division', { max: 10, re: RE_DIVISION });
  text('lcNumber', { max: 30, re: RE_LC });
  text('favouriteTeacher', { max: 100 });

  // Step 3 – contact
  phone('mobile', true);
  phone('whatsapp', true);
  phone('altPhone', false);
  const email = cleanText_(p.email).toLowerCase();
  data.email = email;
  if (!email) errors.email = 'required';
  else if (email.length > 120) errors.email = 'tooLong';
  else if (!RE_EMAIL.test(email) || email.indexOf('..') !== -1) errors.email = 'emailInvalid';

  // Step 4 – location
  const cc = String(p.countryCode || '').trim().toUpperCase();
  const country = getCountryMap_()[cc];
  if (!cc) errors.countryCode = 'required';
  else if (!country) errors.countryCode = 'invalid';
  data.countryCode = country ? cc : '';
  data.country = country ? country.name : '';
  text('state', { required: true, max: 80 });
  text('city', { required: true, max: 80 });
  text('postalCode', { max: 12, re: RE_POSTAL });
  text('address', { max: 300, multiline: true });

  // Step 5 – profession
  const occ = choice('occupation', OPTIONS.OCCUPATION, true);
  const employerOptional = !occ || OCCUPATIONS_WITHOUT_EMPLOYER.indexOf(occ) !== -1;
  text('occupationOther', { required: occ === 'OTHER', max: 80 });
  if (occ !== 'OTHER') data.occupationOther = '';
  text('organization', { required: !employerOptional, max: 120 });
  text('designation', { required: !employerOptional, max: 100 });
  text('professionalField', { required: !employerOptional, max: 100 });
  let site = cleanText_(p.website);
  if (site && !/^https?:\/\//i.test(site)) site = 'https://' + site;
  p.website = site;
  text('website', { max: 200, re: RE_URL });

  // Step 6 – achievements & memories (optional, long text)
  ['achievements', 'awards', 'socialContributions', 'schoolMemory', 'messageForSchool', 'teachersRemembered']
    .forEach(function (k) { text(k, { max: 1000, multiline: true }); });

  // Step 7 – participation
  PARTICIPATION_KEYS.forEach(function (k) { choice(k, OPTIONS.PARTICIPATION, true); });

  // Step 8 – consent (admins cannot change consent records)
  let photo = null;
  if (mode === 'public') {
    data.consentStore = isYes_(p.consentStore);
    data.consentContact = isYes_(p.consentContact);
    data.consentDirectory = isYes_(p.consentDirectory);
    data.consentPrivacy = isYes_(p.consentPrivacy);
    data.consentPhoto = isYes_(p.consentPhoto);
    if (!data.consentStore) errors.consentStore = 'consentRequired';
    if (!data.consentContact) errors.consentContact = 'consentRequired';
    if (!data.consentPrivacy) errors.consentPrivacy = 'consentRequired';
    data.language = p.language === 'hi' ? 'hi' : 'gu';

    if (p.photo && p.photo.data) {
      if (!data.consentPhoto) errors.consentPhoto = 'consentRequired';
      const r = validatePhoto_(p.photo, opts.maxPhotoBytes || APP.MAX_PHOTO_MB_DEFAULT * 1024 * 1024);
      if (r.error) errors.photo = r.error; else photo = r;
    } else {
      data.consentPhoto = false;
    }
  }

  return { ok: Object.keys(errors).length === 0, data: data, errors: errors, photo: photo };
}

/**
 * Validates an uploaded image: declared type, real file signature and size.
 * @return {{bytes:Array<number>, mimeType:string, ext:string}|{error:string}}
 */
function validatePhoto_(photo, maxBytes) {
  const mime = String(photo.mimeType || '').toLowerCase();
  if (APP.ALLOWED_PHOTO_TYPES.indexOf(mime) === -1) return { error: 'fileType' };
  const b64 = String(photo.data || '').replace(/^data:[^,]+,/, '');
  if (b64.length > Math.ceil(maxBytes * 4 / 3) + 8) return { error: 'fileSize' };
  let bytes;
  try { bytes = Utilities.base64Decode(b64); } catch (e) { return { error: 'fileType' }; }
  if (!bytes || bytes.length < 12) return { error: 'fileType' };
  if (bytes.length > maxBytes) return { error: 'fileSize' };
  const b = function (i) { return bytes[i] & 0xff; };
  let detected = '';
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) detected = 'image/jpeg';
  else if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) detected = 'image/png';
  else if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 &&
           b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) detected = 'image/webp';
  if (detected !== mime) return { error: 'fileType' };
  return { bytes: bytes, mimeType: mime, ext: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime] };
}

/** Normalised name used for duplicate matching. */
function normaliseName_(s) {
  return cleanText_(s).toLowerCase().replace(/[.'’\-]/g, ' ').replace(/\s+/g, ' ').trim();
}
