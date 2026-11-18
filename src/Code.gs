/**
 * Code.gs
 * ---------------------------------------------------------------------------
 * Web-app entry points, one-time setup and public (anonymous) API.
 *
 * Public functions callable from the browser via google.script.run:
 *   submitRegistration, getPublicStats, getPublicDirectory, getPublicMemories
 * Admin functions live in Admin.gs and verify the caller on every call.
 * Owner-only maintenance: setup, addAdmin, removeAdmin, dailyMaintenance.
 */

/* ------------------------------------------------------------- routing */

function doGet(e) {
  const page = e && e.parameter && e.parameter.page === 'admin' ? 'Admin' : 'Index';
  if (!isConfigured_()) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;padding:40px;text-align:center"><h2>Portal setup pending</h2>' +
      '<p>The school administrator must run <code>setup()</code> once from the Apps Script editor.</p></div>')
      .setTitle('Setup pending');
  }
  const tpl = HtmlService.createTemplateFromFile(page);
  let settings = {};
  try { settings = getPublicSettings_(); } catch (err) { console.error('settings: ' + err); }
  const boot = getClientBootstrap_();
  boot.settings = settings;
  // Escape "<" so the JSON can never close the surrounding <script> tag.
  tpl.bootstrapJson = JSON.stringify(boot).replace(/</g, '\\u003c');
  return tpl.evaluate()
    .setTitle(page === 'Admin' ? 'Admin – Centenary 2028 Alumni' : 'Centenary 1928–2028 · Global Alumni Registration')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

const INCLUDABLE = Object.freeze(['CSS', 'JavaScript', 'Translations', 'Registration']);

/** Template helper: <?!= include('CSS'); ?> */
function include(filename) {
  if (INCLUDABLE.indexOf(filename) === -1) throw new Error('Not includable');
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* ----------------------------------------------------- owner utilities */

/**
 * Allows a function only when run by the project owner from the editor /
 * a trigger – never by an anonymous web visitor (whose active user is empty).
 */
function requireOwner_() {
  let active = '', effective = '';
  try { active = String(Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) { /* */ }
  try { effective = String(Session.getEffectiveUser().getEmail() || '').toLowerCase(); } catch (e) { /* */ }
  const owner = String(props_().getProperty(PROP.OWNER_EMAIL) || '').toLowerCase();
  if (!active || active !== effective || (owner && active !== owner)) throw new Error('Owner only. Run this from the Apps Script editor.');
  return active;
}

/**
 * ONE-TIME SETUP – run from the Apps Script editor (Run ▸ setup).
 * Creates the Drive folder tree, the database spreadsheet with all sheets,
 * registers you as SUPER_ADMIN and installs the daily backup trigger.
 * Safe to run again: it repairs missing pieces without deleting data.
 */
function setup() {
  const owner = requireOwner_();
  const p = props_();
  const root = ensureFolderStructure_();

  let ss = null;
  const existingId = p.getProperty(PROP.SPREADSHEET_ID);
  if (existingId) {
    try { ss = SpreadsheetApp.openById(existingId); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(SPREADSHEET_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(root);
    p.setProperty(PROP.SPREADSHEET_ID, ss.getId());
  }
  __ss = ss;
  ss.setSpreadsheetTimeZone(APP.TIMEZONE);
  ensureSheets_(ss);
  p.setProperty(PROP.OWNER_EMAIL, owner);

  const adminSheet = ss.getSheetByName(SHEETS.ADMINS);
  const admins = getAdmins_();
  if (!admins.some(function (a) { return a.email === owner; })) {
    adminSheet.appendRow([owner, 'Project Owner', 'SUPER_ADMIN', 'TRUE', new Date(), 'Created by setup()']);
  }
  protectSheets_(ss, owner);

  if (!p.getProperty(PROP.REG_SEQ)) p.setProperty(PROP.REG_SEQ, String(highestExistingSequence_()));

  // Daily maintenance trigger (backup + summary rebuild) at ~02:00 IST.
  const exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'dailyMaintenance'; });
  if (!exists) ScriptApp.newTrigger('dailyMaintenance').timeBased().everyDays(1).atHour(2).create();

  CacheService.getScriptCache().remove('settings_v1');
  logActivity_('SETUP', '', owner, 'SUCCESS', { version: APP.VERSION });
  const msg = 'Setup complete.\nSpreadsheet: ' + ss.getUrl() + '\nFolder: ' + root.getUrl();
  console.log(msg);
  return msg;
}

/**
 * Adds or re-activates an admin and gives them private edit access to the
 * portal folder. Run from the editor, e.g.  addAdmin('principal@gmail.com', 'Principal', 'ADMIN')
 */
function addAdmin(email, name, role) {
  const owner = requireOwner_();
  email = String(email || '').trim().toLowerCase();
  role = String(role || 'ADMIN').toUpperCase();
  if (!RE_EMAIL.test(email)) throw new Error('Invalid email');
  if (!ROLES[role]) throw new Error('Role must be SUPER_ADMIN, ADMIN or VIEWER');
  const sh = getSheet_(SHEETS.ADMINS);
  const rows = readTable_(sh, ADMIN_HEADERS.length);
  const i = rows.findIndex(function (r) { return String(r[0]).trim().toLowerCase() === email; });
  if (i >= 0) sh.getRange(i + 2, 2, 1, 3).setValues([[cellSafe_(name || rows[i][1]), role, 'TRUE']]);
  else sh.appendRow([cellSafe_(email), cellSafe_(name || ''), role, 'TRUE', new Date(), 'Added by ' + owner]);
  shareWithAdmin_(email);
  logActivity_('ADMIN_ADDED', '', owner, 'SUCCESS', { email: email, role: role });
  return 'Admin ' + email + ' (' + role + ') added.';
}

/** Deactivates an admin and removes their Drive access. */
function removeAdmin(email) {
  const owner = requireOwner_();
  email = String(email || '').trim().toLowerCase();
  const sh = getSheet_(SHEETS.ADMINS);
  const rows = readTable_(sh, ADMIN_HEADERS.length);
  const i = rows.findIndex(function (r) { return String(r[0]).trim().toLowerCase() === email; });
  if (i < 0) return 'Not found';
  sh.getRange(i + 2, 4).setValue('FALSE');
  try {
    getFolder_(PROP.ROOT_FOLDER_ID).removeEditor(email);
    SpreadsheetApp.openById(props_().getProperty(PROP.SPREADSHEET_ID)).removeEditor(email);
  } catch (e) { console.warn('removeAdmin: ' + e); }
  logActivity_('ADMIN_REMOVED', '', owner, 'SUCCESS', { email: email });
  return 'Admin ' + email + ' deactivated.';
}

/**
 * Daily trigger: backup + summary rebuild. Accepts only a genuine trigger
 * event (or the owner running it from the editor).
 */
function dailyMaintenance(e) {
  const isTrigger = e && e.triggerUid && ScriptApp.getProjectTriggers().some(function (t) {
    return t.getUniqueId() === String(e.triggerUid);
  });
  if (!isTrigger) requireOwner_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) { console.warn('dailyMaintenance: busy'); return; }
  try {
    rebuildSummaries_();
  } finally {
    lock.releaseLock();
  }
  invalidateDataCaches_();
  runBackup_();
}

/* -------------------------------------------------------- public API */

/** Wraps public calls so the browser always receives a translatable code. */
function publicCall_(name, fn) {
  try {
    if (!isConfigured_()) return { ok: false, code: 'NOT_CONFIGURED' };
    return fn();
  } catch (err) {
    console.error(name + ' failed: ' + (err && err.stack || err));
    logActivity_('ERROR', '', 'public', name, String(err && err.message || err));
    return { ok: false, code: err && err.appCode ? err.appCode : 'SERVER' };
  }
}

function submitRegistration(payload) {
  return publicCall_('submitRegistration', function () { return submitRegistration_(payload); });
}

/** Aggregate counts only (no personal data), from the summary sheets. */
function getPublicStats() {
  return publicCall_('getPublicStats', function () {
    if (!settingTrue_('PUBLIC_STATS_ENABLED')) return { ok: true, enabled: false };
    const cached = cacheGetJson_('public_stats');
    if (cached) return cached;
    const countries = readTable_(getSheet_(SHEETS.COUNTRIES), 3)
      .map(function (r) { return [String(r[0]), Number(r[2]) || 0]; })
      .filter(function (r) { return r[0] && r[1] > 0; })
      .sort(function (a, b) { return b[1] - a[1]; });
    const batches = readTable_(getSheet_(SHEETS.BATCHES), 2)
      .map(function (r) { return [Number(r[0]), Number(r[1]) || 0]; })
      .filter(function (r) { return r[0] && r[1] > 0; });
    const decades = {};
    batches.forEach(function (b) { const d = Math.floor(b[0] / 10) * 10; decades[d] = (decades[d] || 0) + b[1]; });
    let total = 0, india = 0;
    countries.forEach(function (c) { total += c[1]; if (c[0] === 'IN') india = c[1]; });
    const out = {
      ok: true, enabled: true, total: total, india: india, abroad: total - india,
      countriesCount: countries.length, byCountry: countries,
      byDecade: Object.keys(decades).sort().map(function (d) { return [Number(d), decades[d]]; })
    };
    cachePutJson_('public_stats', out, APP.CACHE_TTL_PUBLIC);
    return out;
  });
}

/** Builds (and caches) the list of consented + approved public profiles. */
function publicProfiles_() {
  let list = cacheGetJson_('public_dir');
  if (list) return list;
  list = readMasterColumns_(['timestamp', 'registrationId', 'fullName', 'leavingYear', 'countryCode', 'city', 'occupation',
    'schoolMemory', 'consentDirectory', 'moderation'])
    .filter(function (r) { return r.consentDirectory === 'YES' && r.moderation === 'APPROVED'; })
    .map(function (r) {
      return { n: r.fullName, y: r.leavingYear, c: r.countryCode, ci: r.city, o: r.occupation,
        m: String(r.schoolMemory || '').slice(0, 400), t: r.timestamp };
    })
    .sort(function (a, b) { return String(a.n).localeCompare(String(b.n)); });
  cachePutJson_('public_dir', list, APP.CACHE_TTL_PUBLIC);
  return list;
}

/** Public directory – only alumni who consented AND whose profile an admin approved. */
function getPublicDirectory(query) {
  return publicCall_('getPublicDirectory', function () {
    if (!settingTrue_('DIRECTORY_ENABLED')) return { ok: true, enabled: false, rows: [], total: 0 };
    query = query || {};
    const q = normaliseName_(String(query.q || '').slice(0, 60));
    const year = query.year ? String(query.year) : '';
    const all = publicProfiles_().filter(function (p) {
      if (year && String(p.y) !== year) return false;
      return !q || normaliseName_(p.n).indexOf(q) !== -1 || normaliseName_(p.ci).indexOf(q) !== -1;
    });
    const size = APP.DIRECTORY_PAGE_SIZE;
    const page = Math.max(1, Math.min(Math.ceil(all.length / size) || 1, Number(query.page) || 1));
    return {
      ok: true, enabled: true, total: all.length, page: page, pages: Math.max(1, Math.ceil(all.length / size)),
      rows: all.slice((page - 1) * size, page * size).map(function (p) {
        return { name: p.n, year: p.y, country: p.c, city: p.ci, occupation: p.o };
      })
    };
  });
}

/** Latest approved school memories for the Memories section. */
function getPublicMemories() {
  return publicCall_('getPublicMemories', function () {
    if (!settingTrue_('DIRECTORY_ENABLED')) return { ok: true, rows: [] };
    const rows = publicProfiles_().filter(function (p) { return p.m; })
      .sort(function (a, b) { return String(b.t).localeCompare(String(a.t)); })
      .slice(0, 9)
      .map(function (p) { return { name: p.n, year: p.y, country: p.c, memory: p.m }; });
    return { ok: true, rows: rows };
  });
}
