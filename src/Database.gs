/**
 * Database.gs
 * ---------------------------------------------------------------------------
 * Google Sheets data-access layer. All reads/writes use batch range calls.
 * Functions ending in "_" are private: google.script.run cannot call them.
 */

let __ss = null;
let __settings = null;

function props_() { return PropertiesService.getScriptProperties(); }

/** Structured application error with a machine-readable code. */
function appError_(code, extra) {
  const e = new Error(code);
  e.appCode = code;
  if (extra) e.extra = extra;
  return e;
}

function isConfigured_() {
  return !!props_().getProperty(PROP.SPREADSHEET_ID);
}

function getSpreadsheet_() {
  if (__ss) return __ss;
  const id = props_().getProperty(PROP.SPREADSHEET_ID);
  if (!id) throw appError_('NOT_CONFIGURED');
  __ss = SpreadsheetApp.openById(id);
  return __ss;
}

function getSheet_(name) {
  const sh = getSpreadsheet_().getSheetByName(name);
  if (!sh) throw appError_('SHEET_MISSING', { sheet: name });
  return sh;
}

/* ------------------------------------------------------------------ setup */

/**
 * Creates (or repairs) every sheet with headers and formatting.
 * Idempotent: existing data is never cleared.
 */
function ensureSheets_(ss) {
  const definitions = [
    [SHEETS.MASTER, MASTER_SCHEMA.map(function (c) { return c.header; }), '#7a1f2b'],
    [SHEETS.LOGS, LOG_HEADERS, '#1f2f56'],
    [SHEETS.COUNTRIES, COUNTRY_SUMMARY_HEADERS, '#b08d3c'],
    [SHEETS.OCCUPATIONS, OCCUPATION_SUMMARY_HEADERS, '#b08d3c'],
    [SHEETS.BATCHES, BATCH_SUMMARY_HEADERS, '#b08d3c'],
    [SHEETS.ADMINS, ADMIN_HEADERS, '#1f2f56'],
    [SHEETS.SETTINGS, SETTINGS_HEADERS, '#1f2f56']
  ];
  definitions.forEach(function (d) {
    let sh = ss.getSheetByName(d[0]);
    if (!sh) sh = ss.insertSheet(d[0]);
    const headers = d[1];
    if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setFontColor('#ffffff').setBackground(d[2]).setWrap(true);
    sh.setFrozenRows(1);
    sh.setTabColor(d[2]);
  });

  // Master: freeze ID + name columns, date formats.
  const master = ss.getSheetByName(SHEETS.MASTER);
  master.setFrozenColumns(4);
  MASTER_SCHEMA.forEach(function (c, i) {
    if (c.type === 'date') master.getRange(2, i + 1, master.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  });
  ss.getSheetByName(SHEETS.LOGS).getRange(2, 1, ss.getSheetByName(SHEETS.LOGS).getMaxRows() - 1, 1)
    .setNumberFormat('yyyy-mm-dd hh:mm:ss');

  // Settings defaults (only add missing keys).
  const settingsSheet = ss.getSheetByName(SHEETS.SETTINGS);
  const existing = readTable_(settingsSheet, SETTINGS_HEADERS.length).map(function (r) { return String(r[0]); });
  const missing = DEFAULT_SETTINGS.filter(function (s) { return existing.indexOf(s[0]) === -1; });
  if (missing.length) {
    settingsSheet.getRange(settingsSheet.getLastRow() + 1, 1, missing.length, 3).setValues(missing.map(function (s) { return s.slice(); }));
  }

  // Remove the default empty "Sheet1" if present.
  const def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);
}

/** Protect configuration sheets so that only the owner can change them. */
function protectSheets_(ss, ownerEmail) {
  [SHEETS.ADMINS, SHEETS.SETTINGS, SHEETS.LOGS].forEach(function (name) {
    const sh = ss.getSheetByName(name);
    const p = sh.protect().setDescription('Owner only – ' + name);
    try {
      p.removeEditors(p.getEditors());
      if (ownerEmail) p.addEditor(ownerEmail);
      if (p.canDomainEdit()) p.setDomainEdit(false);
    } catch (err) {
      console.warn('protectSheets_: ' + err);
    }
  });
}

/* ------------------------------------------------------------- utilities */

/** Reads all data rows (excluding header) of a sheet. */
function readTable_(sheet, numCols) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, numCols || sheet.getLastColumn()).getValues();
}

/**
 * Makes a value safe to write into a cell:
 *  - strings are prefixed with an apostrophe so Sheets stores them literally
 *    (prevents formula injection like "=IMPORTXML(...)" and keeps leading
 *    zeros / "+91" phone numbers / date-like text intact).
 */
function cellSafe_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date || typeof v === 'number' || typeof v === 'boolean') return v;
  const s = String(v);
  return s === '' ? '' : "'" + s;
}

function toBoolCell_(v) { return v ? 'YES' : 'NO'; }

/** Alumni record object → sheet row. */
function recordToRow_(rec) {
  return MASTER_SCHEMA.map(function (c) {
    const v = rec[c.key];
    if (c.type === 'bool') return toBoolCell_(v === true || v === 'YES');
    if (c.type === 'date') return v instanceof Date ? v : (v ? new Date(v) : '');
    if (c.type === 'number') return v === '' || v === null || v === undefined ? '' : Number(v);
    return cellSafe_(v);
  });
}

/** Sheet row → plain record object (Dates converted to ISO strings for google.script.run). */
function rowToRecord_(row) {
  const rec = {};
  MASTER_SCHEMA.forEach(function (c, i) {
    let v = row[i];
    if (c.type === 'bool') v = (v === true || String(v).toUpperCase() === 'YES');
    else if (v instanceof Date) v = isNaN(v.getTime()) ? '' : v.toISOString();
    else if (c.type === 'number') v = v === '' ? '' : Number(v);
    else v = v === null || v === undefined ? '' : String(v);
    rec[c.key] = v;
  });
  return rec;
}

/* ------------------------------------------------------------- master IO */

function readMasterRows_() {
  return readTable_(getSheet_(SHEETS.MASTER), MASTER_SCHEMA.length);
}

function readAllRecords_() {
  return readMasterRows_().map(rowToRecord_);
}

/**
 * Reads only the columns needed (one getRange covering the span of keys).
 * @return {Array<Object>} light records containing just those keys + _row.
 */
function readMasterColumns_(keys) {
  const idx = masterIndex_();
  const cols = keys.map(function (k) { return idx[k]; });
  const min = Math.min.apply(null, cols);
  const max = Math.max.apply(null, cols);
  const sh = getSheet_(SHEETS.MASTER);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const values = sh.getRange(2, min + 1, last - 1, max - min + 1).getValues();
  return values.map(function (r, i) {
    const o = { _row: i + 2 };
    keys.forEach(function (k) {
      const v = r[idx[k] - min];
      o[k] = v instanceof Date ? v.toISOString() : String(v === null || v === undefined ? '' : v);
    });
    return o;
  });
}

function appendMasterRecord_(rec) {
  getSheet_(SHEETS.MASTER).appendRow(recordToRow_(rec));
}

/** @return {{row:number, record:Object}|null} */
function findRecordById_(registrationId) {
  const id = String(registrationId || '').trim().toUpperCase();
  if (!/^ALM-\d{4}-\d{6}$/.test(id)) return null;
  const sh = getSheet_(SHEETS.MASTER);
  const last = sh.getLastRow();
  if (last < 2) return null;
  const col = masterIndex_().registrationId + 1;
  const ids = sh.getRange(2, col, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).toUpperCase() === id) {
      const rowNum = i + 2;
      const row = sh.getRange(rowNum, 1, 1, MASTER_SCHEMA.length).getValues()[0];
      return { row: rowNum, record: rowToRecord_(row) };
    }
  }
  return null;
}

function writeMasterRecord_(rowNum, rec) {
  getSheet_(SHEETS.MASTER).getRange(rowNum, 1, 1, MASTER_SCHEMA.length).setValues([recordToRow_(rec)]);
}

function deleteMasterRow_(rowNum) {
  getSheet_(SHEETS.MASTER).deleteRow(rowNum);
}

/* -------------------------------------------------------------- logging */

/**
 * Appends one activity entry to Registration_Logs. Never throws:
 * logging must not break the main flow.
 */
function logActivity_(action, registrationId, actor, status, details, token) {
  try {
    const d = typeof details === 'string' ? details : JSON.stringify(details || {});
    getSheet_(SHEETS.LOGS).appendRow([
      new Date(), cellSafe_(action), cellSafe_(registrationId || ''), cellSafe_(actor || ''),
      cellSafe_(status || ''), cellSafe_(d.slice(0, 2000)), cellSafe_(token || '')
    ]);
  } catch (err) {
    console.error('logActivity_ failed: ' + err);
  }
}

/* ------------------------------------------------------------ summaries */

/** Increments (or decrements) a row in a summary sheet keyed on column A. */
function bumpSummary_(sheetName, key, label, delta) {
  if (key === '' || key === null || key === undefined) return;
  const sh = getSheet_(sheetName);
  const hasLabel = sheetName !== SHEETS.BATCHES;
  const width = hasLabel ? 4 : 3;
  const rows = readTable_(sh, width);
  const countCol = hasLabel ? 3 : 2;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(key)) {
      const next = Math.max(0, Number(rows[i][countCol - 1] || 0) + delta);
      sh.getRange(i + 2, countCol, 1, 2).setValues([[next, new Date()]]);
      return;
    }
  }
  if (delta > 0) {
    sh.appendRow(hasLabel ? [cellSafe_(key), cellSafe_(label), delta, new Date()] : [Number(key), delta, new Date()]);
  }
}

function applySummaryDelta_(rec, delta) {
  bumpSummary_(SHEETS.COUNTRIES, rec.countryCode, rec.country, delta);
  bumpSummary_(SHEETS.OCCUPATIONS, rec.occupation, OCCUPATION_LABELS_EN[rec.occupation] || rec.occupation, delta);
  bumpSummary_(SHEETS.BATCHES, rec.leavingYear, '', delta);
}

/** Recomputes all three summary sheets from Alumni_Master in one pass. */
function rebuildSummaries_(records) {
  records = records || readAllRecords_();
  const now = new Date();
  const countries = {}, occupations = {}, batches = {};
  records.forEach(function (r) {
    if (r.countryCode) {
      countries[r.countryCode] = countries[r.countryCode] || { name: r.country, n: 0 };
      countries[r.countryCode].n++;
    }
    if (r.occupation) occupations[r.occupation] = (occupations[r.occupation] || 0) + 1;
    if (r.leavingYear !== '') batches[r.leavingYear] = (batches[r.leavingYear] || 0) + 1;
  });
  const write = function (name, headers, rows) {
    const sh = getSheet_(name);
    const last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, headers.length).clearContent();
    if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  };
  write(SHEETS.COUNTRIES, COUNTRY_SUMMARY_HEADERS, Object.keys(countries)
    .sort(function (a, b) { return countries[b].n - countries[a].n; })
    .map(function (k) { return [cellSafe_(k), cellSafe_(countries[k].name), countries[k].n, now]; }));
  write(SHEETS.OCCUPATIONS, OCCUPATION_SUMMARY_HEADERS, Object.keys(occupations)
    .sort(function (a, b) { return occupations[b] - occupations[a]; })
    .map(function (k) { return [cellSafe_(k), cellSafe_(OCCUPATION_LABELS_EN[k] || k), occupations[k], now]; }));
  write(SHEETS.BATCHES, BATCH_SUMMARY_HEADERS, Object.keys(batches)
    .sort()
    .map(function (k) { return [Number(k), batches[k], now]; }));
}

/* --------------------------------------------------- settings & admins */

function getSettings_() {
  if (__settings) return __settings;
  const cache = CacheService.getScriptCache();
  const cached = cache.get('settings_v1');
  if (cached) { __settings = JSON.parse(cached); return __settings; }
  const out = {};
  DEFAULT_SETTINGS.forEach(function (s) { out[s[0]] = s[1]; });
  readTable_(getSheet_(SHEETS.SETTINGS), 2).forEach(function (r) {
    if (r[0]) out[String(r[0]).trim()] = String(r[1] === null || r[1] === undefined ? '' : r[1]).trim();
  });
  __settings = out;
  cache.put('settings_v1', JSON.stringify(out), 300);
  return out;
}

function settingTrue_(key) {
  return String(getSettings_()[key]).toUpperCase() === 'TRUE';
}

function getPublicSettings_() {
  const s = getSettings_();
  const out = {};
  PUBLIC_SETTING_KEYS.forEach(function (k) { out[k] = s[k] === undefined ? '' : s[k]; });
  return out;
}

/** @return {Array<{email,name,role,active}>} */
function getAdmins_() {
  return readTable_(getSheet_(SHEETS.ADMINS), ADMIN_HEADERS.length).map(function (r) {
    return {
      email: String(r[0]).trim().toLowerCase(),
      name: String(r[1] || ''),
      role: String(r[2] || '').trim().toUpperCase(),
      active: String(r[3]).toUpperCase() === 'TRUE' || r[3] === true || String(r[3]).toUpperCase() === 'YES'
    };
  }).filter(function (a) { return a.email; });
}

/* ---------------------------------------------------------------- cache */

/** Stores JSON in CacheService, chunked to respect the 100 KB/key limit. */
function cachePutJson_(key, obj, ttl) {
  try {
    const cache = CacheService.getScriptCache();
    const json = JSON.stringify(obj);
    const size = 90000;
    const parts = Math.ceil(json.length / size) || 1;
    if (parts > 20) return; // too large – skip caching
    const map = {};
    for (let i = 0; i < parts; i++) map[key + '_' + i] = json.substr(i * size, size);
    map[key + '_n'] = String(parts);
    cache.putAll(map, ttl);
  } catch (err) {
    console.warn('cachePutJson_ ' + key + ': ' + err);
  }
}

function cacheGetJson_(key) {
  try {
    const cache = CacheService.getScriptCache();
    const n = Number(cache.get(key + '_n'));
    if (!n) return null;
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(key + '_' + i);
    const got = cache.getAll(keys);
    let json = '';
    for (let i = 0; i < n; i++) {
      if (got[keys[i]] === undefined || got[keys[i]] === null) return null;
      json += got[keys[i]];
    }
    return JSON.parse(json);
  } catch (err) {
    return null;
  }
}

/** Drops cached aggregates after any data change. */
function invalidateDataCaches_() {
  const cache = CacheService.getScriptCache();
  cache.removeAll(['public_stats_n', 'public_dir_n', 'public_mem_n', 'admin_stats_n']);
}
