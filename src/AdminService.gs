/**
 * Admin.gs
 * ---------------------------------------------------------------------------
 * Secure admin API. EVERY public function here re-checks the caller's Google
 * identity against the Admin_Users sheet – security never depends on the URL.
 *
 * Roles: SUPER_ADMIN (everything) > ADMIN (edit, export, reports) > VIEWER (read).
 */

/** @return {{email:string,name:string,role:string,level:number}|null} */
function getAdminUser_() {
  let email = '';
  try { email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase(); } catch (e) { email = ''; }
  if (!email) return null;
  const owner = String(props_().getProperty(PROP.OWNER_EMAIL) || '').toLowerCase();
  if (owner && email === owner) return { email: email, name: 'Owner', role: 'SUPER_ADMIN', level: ROLES.SUPER_ADMIN };
  const a = getAdmins_().filter(function (x) { return x.email === email && x.active; })[0];
  if (!a || !ROLES[a.role]) return null;
  return { email: email, name: a.name, role: a.role, level: ROLES[a.role] };
}

/** Runs fn(user) if the caller has at least minRole; returns a uniform envelope. */
function adminCall_(minRole, action, fn) {
  try {
    if (!isConfigured_()) return { ok: false, code: 'NOT_CONFIGURED' };
    const user = getAdminUser_();
    if (!user || user.level < ROLES[minRole]) {
      let who = '';
      try { who = Session.getActiveUser().getEmail(); } catch (e) { /* anonymous */ }
      logActivity_('ADMIN_DENIED', '', who || 'anonymous', 'FORBIDDEN', action);
      return { ok: false, code: who ? 'FORBIDDEN' : 'NOT_SIGNED_IN' };
    }
    return { ok: true, data: fn(user) };
  } catch (err) {
    if (err && err.appCode) return { ok: false, code: err.appCode, extra: err.extra || null };
    console.error('Admin ' + action + ' failed: ' + (err && err.stack || err));
    logActivity_('ERROR', '', 'admin', action, String(err && err.message || err));
    return { ok: false, code: 'SERVER' };
  }
}

/* ------------------------------------------------------------- context */

function adminGetContext() {
  return adminCall_('VIEWER', 'context', function (u) {
    return { email: u.email, name: u.name, role: u.role, version: APP.VERSION };
  });
}

/* ---------------------------------------------------------- statistics */

function titleKey_(s) { return cleanText_(s).toLowerCase(); }

function topN_(map, n) {
  return Object.keys(map).map(function (k) { return [map[k].label, map[k].n]; })
    .sort(function (a, b) { return b[1] - a[1] || String(a[0]).localeCompare(String(b[0])); })
    .slice(0, n);
}

function computeStats_(records) {
  const st = {
    total: records.length, india: 0, abroad: 0, withPhoto: 0, directoryConsent: 0,
    pendingModeration: 0, softDuplicates: 0, last7: 0,
    byCountry: {}, byState: {}, byCity: {}, byYear: {}, byOccupation: {}, participation: {}, daily: {}
  };
  PARTICIPATION_KEYS.forEach(function (k) { st.participation[k] = { YES: 0, NO: 0, MAYBE: 0 }; });
  const now = Date.now();
  const tz = APP.TIMEZONE;
  for (let d = 29; d >= 0; d--) st.daily[Utilities.formatDate(new Date(now - d * 86400000), tz, 'yyyy-MM-dd')] = 0;

  records.forEach(function (r) {
    if (r.countryCode === 'IN') st.india++; else if (r.countryCode) st.abroad++;
    if (r.photoFileId) st.withPhoto++;
    if (r.consentDirectory) st.directoryConsent++;
    if (r.moderation === 'PENDING') st.pendingModeration++;
    if (r.possibleDuplicateOf) st.softDuplicates++;
    if (r.countryCode) {
      st.byCountry[r.countryCode] = st.byCountry[r.countryCode] || { label: r.countryCode, n: 0 };
      st.byCountry[r.countryCode].n++;
    }
    if (r.state) {
      const k = titleKey_(r.state) + '|' + r.countryCode;
      st.byState[k] = st.byState[k] || { label: r.state + ' · ' + r.countryCode, n: 0 };
      st.byState[k].n++;
    }
    if (r.city) {
      const k = titleKey_(r.city) + '|' + r.countryCode;
      st.byCity[k] = st.byCity[k] || { label: r.city + ' · ' + r.countryCode, n: 0 };
      st.byCity[k].n++;
    }
    if (r.leavingYear !== '') st.byYear[r.leavingYear] = (st.byYear[r.leavingYear] || 0) + 1;
    if (r.occupation) st.byOccupation[r.occupation] = (st.byOccupation[r.occupation] || 0) + 1;
    PARTICIPATION_KEYS.forEach(function (k) { if (st.participation[k][r[k]] !== undefined) st.participation[k][r[k]]++; });
    if (r.timestamp) {
      const t = new Date(r.timestamp).getTime();
      if (now - t <= 7 * 86400000) st.last7++;
      const day = Utilities.formatDate(new Date(t), tz, 'yyyy-MM-dd');
      if (st.daily[day] !== undefined) st.daily[day]++;
    }
  });
  return {
    total: st.total, india: st.india, abroad: st.abroad, withPhoto: st.withPhoto,
    directoryConsent: st.directoryConsent, pendingModeration: st.pendingModeration,
    softDuplicates: st.softDuplicates, last7: st.last7,
    countriesCount: Object.keys(st.byCountry).length,
    byCountry: topN_(st.byCountry, 250),
    byState: topN_(st.byState, 25),
    byCity: topN_(st.byCity, 25),
    byYear: Object.keys(st.byYear).sort().map(function (y) { return [Number(y), st.byYear[y]]; }),
    byOccupation: Object.keys(st.byOccupation).map(function (k) { return [k, st.byOccupation[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; }),
    participation: st.participation,
    daily: Object.keys(st.daily).map(function (d) { return [d, st.daily[d]]; })
  };
}

function adminGetDashboard() {
  return adminCall_('VIEWER', 'dashboard', function () {
    const cached = cacheGetJson_('admin_stats');
    if (cached) return cached;
    const stats = computeStats_(readAllRecords_());
    stats.generatedAt = new Date().toISOString();
    cachePutJson_('admin_stats', stats, APP.CACHE_TTL_ADMIN);
    return stats;
  });
}

/* -------------------------------------------------------------- search */

function filterRecords_(records, q) {
  q = q || {};
  const text = cleanText_(q.q).toLowerCase().slice(0, 100);
  const field = ['any', 'name', 'mobile', 'id', 'email'].indexOf(q.field) !== -1 ? q.field : 'any';
  const country = String(q.country || '').toUpperCase();
  const year = q.year ? String(q.year) : '';
  const moderation = OPTIONS.MODERATION.indexOf(q.moderation) !== -1 ? q.moderation : '';
  const digits = text.replace(/\D/g, '');
  const nameQ = normaliseName_(text);
  return records.filter(function (r) {
    if (country && r.countryCode !== country) return false;
    if (year && String(r.leavingYear) !== year) return false;
    if (moderation && r.moderation !== moderation) return false;
    if (q.duplicatesOnly && !r.possibleDuplicateOf) return false;
    if (!text) return true;
    const byName = normaliseName_(r.fullName).indexOf(nameQ) !== -1;
    const byMobile = digits.length >= 4 && [r.mobile, r.whatsapp, r.altPhone].some(function (p) { return String(p).replace(/\D/g, '').indexOf(digits) !== -1; });
    const byId = r.registrationId.toLowerCase().indexOf(text) !== -1;
    const byEmail = r.email.indexOf(text) !== -1;
    if (field === 'name') return byName;
    if (field === 'mobile') return byMobile;
    if (field === 'id') return byId;
    if (field === 'email') return byEmail;
    return byName || byMobile || byId || byEmail || titleKey_(r.city).indexOf(text) !== -1;
  }).sort(function (a, b) { return String(b.timestamp).localeCompare(String(a.timestamp)); });
}

function summaryRow_(r) {
  return {
    registrationId: r.registrationId, fullName: r.fullName, admissionYear: r.admissionYear, leavingYear: r.leavingYear,
    city: r.city, state: r.state, countryCode: r.countryCode, occupation: r.occupation, mobile: r.mobile,
    email: r.email, timestamp: r.timestamp, moderation: r.moderation, possibleDuplicateOf: r.possibleDuplicateOf,
    hasPhoto: !!r.photoFileId
  };
}

function adminSearch(query) {
  return adminCall_('VIEWER', 'search', function () {
    const all = filterRecords_(readAllRecords_(), query);
    const size = Math.min(100, Math.max(5, Number(query && query.pageSize) || APP.ADMIN_PAGE_SIZE));
    const pages = Math.max(1, Math.ceil(all.length / size));
    const page = Math.min(pages, Math.max(1, Number(query && query.page) || 1));
    return { total: all.length, page: page, pages: pages, pageSize: size,
      rows: all.slice((page - 1) * size, page * size).map(summaryRow_) };
  });
}

/* ------------------------------------------------------------- profile */

function adminGetProfile(registrationId) {
  return adminCall_('VIEWER', 'profile', function (u) {
    const found = findRecordById_(registrationId);
    if (!found) throw appError_('NOT_FOUND');
    const rec = found.record;
    rec.photoDataUrl = getPhotoDataUrl_(rec.photoFileId);
    logActivity_('VIEW', rec.registrationId, u.email, 'SUCCESS', '');
    return rec;
  });
}

/** Keys an admin may edit (consent records and system fields are excluded). */
const ADMIN_EDITABLE = Object.freeze([
  'fullName', 'gender', 'dob', 'fatherName', 'admissionYear', 'leavingYear', 'lastStandard', 'division', 'lcNumber',
  'favouriteTeacher', 'mobile', 'whatsapp', 'email', 'altPhone', 'countryCode', 'state', 'city', 'postalCode', 'address',
  'occupation', 'occupationOther', 'organization', 'designation', 'professionalField', 'website', 'achievements', 'awards',
  'socialContributions', 'schoolMemory', 'messageForSchool', 'teachersRemembered', 'attendCentenary', 'attendReunion',
  'volunteer', 'supportDevelopment', 'joinAssociation'
]);

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(APP.LOCK_TIMEOUT_MS)) throw appError_('BUSY');
  try { return fn(); } finally { lock.releaseLock(); }
}

function adminUpdateProfile(registrationId, changes) {
  return adminCall_('ADMIN', 'update', function (u) {
    changes = changes && typeof changes === 'object' ? changes : {};
    return withLock_(function () {
      const found = findRecordById_(registrationId);
      if (!found) throw appError_('NOT_FOUND');
      const old = found.record;
      const payload = {};
      ADMIN_EDITABLE.forEach(function (k) { payload[k] = changes.hasOwnProperty(k) ? changes[k] : old[k]; });
      const v = validateRegistration_(payload, { mode: 'admin' });
      if (!v.ok) throw appError_('VALIDATION', { errors: v.errors });
      const dup = findDuplicates_(v.data, old.registrationId);
      if (dup.hard.length) throw appError_('DUPLICATE', { fields: dup.hard });

      const next = Object.assign({}, old);
      const changed = [];
      ADMIN_EDITABLE.concat(['country']).forEach(function (k) {
        if (String(v.data[k]) !== String(old[k])) { changed.push(k); next[k] = v.data[k]; }
      });
      if (changes.hasOwnProperty('adminNotes')) {
        const notes = cleanText_(changes.adminNotes, true).slice(0, 1000);
        if (notes !== old.adminNotes) { changed.push('adminNotes'); next.adminNotes = notes; }
      }
      if (!changed.length) return { changed: [], record: old };
      next.lastUpdated = new Date();
      next.updatedBy = u.email;
      writeMasterRecord_(found.row, next);
      if (old.countryCode !== next.countryCode || old.occupation !== next.occupation || String(old.leavingYear) !== String(next.leavingYear)) {
        applySummaryDelta_(old, -1);
        applySummaryDelta_(next, 1);
      }
      logActivity_('EDIT', old.registrationId, u.email, 'SUCCESS', { fields: changed });
      invalidateDataCaches_();
      next.lastUpdated = next.lastUpdated.toISOString();
      return { changed: changed, record: next };
    });
  });
}

function adminSetModeration(registrationId, status) {
  return adminCall_('ADMIN', 'moderation', function (u) {
    if (['PENDING', 'APPROVED', 'HIDDEN'].indexOf(status) === -1) throw appError_('VALIDATION');
    return withLock_(function () {
      const found = findRecordById_(registrationId);
      if (!found) throw appError_('NOT_FOUND');
      const rec = found.record;
      if (!rec.consentDirectory) throw appError_('NO_CONSENT');
      rec.moderation = status;
      rec.lastUpdated = new Date();
      rec.updatedBy = u.email;
      writeMasterRecord_(found.row, rec);
      logActivity_('MODERATION', rec.registrationId, u.email, status, '');
      invalidateDataCaches_();
      return { moderation: status };
    });
  });
}

/** Permanently deletes a record (e.g. on the alumnus' request). */
function adminDeleteRecord(registrationId, confirmId) {
  return adminCall_('SUPER_ADMIN', 'delete', function (u) {
    if (String(confirmId || '').trim().toUpperCase() !== String(registrationId || '').trim().toUpperCase()) throw appError_('CONFIRM_MISMATCH');
    return withLock_(function () {
      const found = findRecordById_(registrationId);
      if (!found) throw appError_('NOT_FOUND');
      deleteMasterRow_(found.row);
      applySummaryDelta_(found.record, -1);
      trashFile_(found.record.photoFileId);
      logActivity_('DELETE', found.record.registrationId, u.email, 'SUCCESS', 'record and photo removed');
      invalidateDataCaches_();
      return { deleted: found.record.registrationId };
    });
  });
}

/* ------------------------------------------------- export / reports */

function adminExport(query, format) {
  return adminCall_('ADMIN', 'export', function (u) {
    const records = filterRecords_(readAllRecords_(), query).slice(0, APP.MAX_EXPORT_ROWS);
    return exportRecords_(records, format === 'xlsx' ? 'xlsx' : 'csv', u.email);
  });
}

function adminGenerateReport(registrationId, labels) {
  return adminCall_('ADMIN', 'report', function (u) {
    const found = findRecordById_(registrationId);
    if (!found) throw appError_('NOT_FOUND');
    const out = generateAlumniReport_(found.record, labels, u.email);
    logActivity_('REPORT', found.record.registrationId, u.email, 'SUCCESS', out.name);
    return out;
  });
}

/* ---------------------------------------------------- activity & tools */

function adminGetActivity(limit) {
  return adminCall_('VIEWER', 'activity', function () {
    const n = Math.min(500, Math.max(10, Number(limit) || 100));
    const sh = getSheet_(SHEETS.LOGS);
    const last = sh.getLastRow();
    if (last < 2) return [];
    const start = Math.max(2, last - n + 1);
    return sh.getRange(start, 1, last - start + 1, 6).getValues().reverse().map(function (r) {
      return {
        timestamp: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
        action: String(r[1]), registrationId: String(r[2]), actor: String(r[3]), status: String(r[4]), details: String(r[5])
      };
    });
  });
}

function adminRebuildSummaries() {
  return adminCall_('ADMIN', 'rebuild', function (u) {
    return withLock_(function () {
      const records = readAllRecords_();
      rebuildSummaries_(records);
      invalidateDataCaches_();
      logActivity_('REBUILD_SUMMARIES', '', u.email, 'SUCCESS', { records: records.length });
      return { records: records.length };
    });
  });
}

function adminRunBackup() {
  return adminCall_('SUPER_ADMIN', 'backup', function () { return runBackup_(); });
}

function adminGetTools() {
  return adminCall_('SUPER_ADMIN', 'tools', function () {
    const p = props_();
    return {
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + p.getProperty(PROP.SPREADSHEET_ID) + '/edit',
      folderUrl: 'https://drive.google.com/drive/folders/' + p.getProperty(PROP.ROOT_FOLDER_ID),
      admins: getAdmins_()
    };
  });
}
