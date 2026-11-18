/**
 * gas-mock.js
 * In-memory emulation of the Google Apps Script services used by the portal,
 * so the REAL .gs source files can be executed and tested under Node.
 *
 * Fidelity notes (intentionally strict so bugs surface here, not in prod):
 *  - getRange() outside the sheet grid throws, like Sheets does.
 *  - Strings written without a leading apostrophe are auto-parsed like Sheets
 *    (numbers, "+91…" → number, ISO dates → Date, "=…" → formula).
 *  - google.script.run rejects Date objects in return values (see bridge).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', 'src');
let idCounter = 0;
const newId = (p) => p + '_' + (++idCounter).toString(36) + crypto.randomBytes(4).toString('hex');

/* ------------------------------------------------------------------ Blob */
class Blob {
  constructor(bytes, type, name) { this._bytes = Buffer.from(bytes || []); this._type = type || 'application/octet-stream'; this._name = name || ''; }
  getBytes() { return Array.from(this._bytes).map((b) => (b > 127 ? b - 256 : b)); }
  getContentType() { return this._type; }
  setContentType(t) { this._type = t; return this; }
  getName() { return this._name; }
  setName(n) { this._name = n; return this; }
  getDataAsString() { return this._bytes.toString('utf8'); }
  setDataFromString(s) { this._bytes = Buffer.from(s, 'utf8'); return this; }
  copyBlob() { return new Blob(this._bytes, this._type, this._name); }
}
const toBuf = (bytes) => Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b)));

/* ---------------------------------------------------------- Spreadsheets */
function sheetsParse(v) {
  if (typeof v !== 'string') return { value: v };
  if (v.startsWith("'")) return { value: v.slice(1) };
  if (v.startsWith('=')) return { value: v, formula: true };
  if (/^[+-]?\d+(\.\d+)?$/.test(v)) return { value: Number(v), coerced: true };
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { value: new Date(v + 'T00:00:00'), coerced: true };
  return { value: v };
}

class Sheet {
  constructor(ss, name) { this.ss = ss; this.name = name; this.rows = []; this.maxRows = 1000; this.maxCols = 26; this.frozen = 0; this.protected = false; return chain(this); }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertColumnsAfter(after, n) { this.maxCols += n; return this; }
  insertRowsAfter(after, n) { this.maxRows += n; return this; }
  getLastRow() {
    for (let r = this.rows.length - 1; r >= 0; r--) if (this.rows[r] && this.rows[r].some((c) => c !== '' && c !== null && c !== undefined)) return r + 1;
    return 0;
  }
  getLastColumn() {
    let m = 0;
    this.rows.forEach((r) => { if (r) for (let c = r.length - 1; c >= 0; c--) if (r[c] !== '' && r[c] !== undefined) { m = Math.max(m, c + 1); break; } });
    return m;
  }
  _get(r, c) { const row = this.rows[r - 1]; const v = row ? row[c - 1] : undefined; return v === undefined || v === null ? '' : v; }
  _set(r, c, v) {
    const p = sheetsParse(v);
    if (p.formula) this.ss.app.formulaWrites.push({ sheet: this.name, r, c, v });
    while (this.rows.length < r) this.rows.push([]);
    this.rows[r - 1][c - 1] = p.value;
  }
  getRange(row, col, numRows, numCols) {
    if (typeof row === 'string') throw new Error('A1 notation not supported by mock');
    numRows = numRows || 1; numCols = numCols || 1;
    if (row < 1 || col < 1 || numRows < 1 || numCols < 1 || row + numRows - 1 > this.maxRows || col + numCols - 1 > this.maxCols) {
      throw new Error(`The coordinates of the range are outside the dimensions of the sheet (${this.name} r${row} c${col} ${numRows}x${numCols}, grid ${this.maxRows}x${this.maxCols}).`);
    }
    return chain(new Range(this, row, col, numRows, numCols));
  }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  appendRow(values) {
    const r = this.getLastRow() + 1;
    if (r > this.maxRows) this.maxRows = r;
    if (values.length > this.maxCols) this.maxCols = values.length;
    values.forEach((v, i) => this._set(r, i + 1, v));
    this.ss.app.calls.appendRow++;
    return this;
  }
  deleteRow(r) { this.rows.splice(r - 1, 1); return this; }
  setFrozenRows(n) { this.frozen = n; return this; }
  protect() { this.protected = true; return chain({ getEditors: () => [], canDomainEdit: () => false }); }
}

class Range {
  constructor(sheet, row, col, nr, nc) { Object.assign(this, { sheet, row, col, nr, nc }); }
  getValues() {
    this.sheet.ss.app.calls.getValues++;
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const line = [];
      for (let c = 0; c < this.nc; c++) { const v = this.sheet._get(this.row + r, this.col + c); line.push(v instanceof Date ? new Date(v.getTime()) : v); }
      out.push(line);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(vals) {
    this.sheet.ss.app.calls.setValues++;
    if (vals.length !== this.nr || vals.some((r) => r.length !== this.nc)) throw new Error(`setValues dimension mismatch: data ${vals.length}x${vals[0] && vals[0].length} vs range ${this.nr}x${this.nc}`);
    vals.forEach((line, r) => line.forEach((v, c) => this.sheet._set(this.row + r, this.col + c, v)));
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  clearContent() { for (let r = 0; r < this.nr; r++) for (let c = 0; c < this.nc; c++) { const row = this.sheet.rows[this.row + r - 1]; if (row) row[this.col + c - 1] = ''; } return this; }
}

/** Wraps an object so unknown methods (formatting calls) are chainable no-ops. */
function chain(obj) {
  const p = new Proxy(obj, {
    get(t, k) {
      if (k in t) {
        const v = t[k];
        if (typeof v !== 'function') return v;
        return (...a) => { const r = v.apply(t, a); return r === t ? p : r; };
      }
      if (typeof k === 'symbol') return undefined;
      return () => p;
    }
  });
  return p;
}

class Spreadsheet {
  constructor(app, name) { this.app = app; this.id = newId('ss'); this.name = name; this.sheets = [new Sheet(this, 'Sheet1')]; this.editors = []; return chain(this); }
  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  getSheets() { return this.sheets.slice(); }
  insertSheet(n) { if (this.getSheetByName(n)) throw new Error('exists'); const s = new Sheet(this, n); this.sheets.push(s); return s; }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
  setSpreadsheetTimeZone() { return this; }
  addEditor(e) { this.editors.push(e); return this; }
  removeEditor(e) { this.editors = this.editors.filter((x) => x !== e); return this; }
}

/* ----------------------------------------------------------------- Drive */
class DFile {
  constructor(drive, name, blob, kind) { this.drive = drive; this.id = newId('file'); this.name = name; this.blob = blob; this.kind = kind || 'file'; this.parent = null; this.trashed = false; this.created = new Date(Date.now() + idCounter); this.description = ''; }
  getId() { return this.id; }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  setTrashed(t) { this.trashed = t; return this; }
  isTrashed() { return this.trashed; }
  moveTo(folder) { this.parent = folder; return this; }
  getBlob() { return this.blob ? this.blob.copyBlob() : new Blob([], 'application/octet-stream', this.name); }
  getAs(type) { return new Blob(Buffer.from('%PDF-mock'), type, this.name + '.pdf'); }
  getDateCreated() { return this.created; }
  setDescription(d) { this.description = d; return this; }
  getUrl() { return 'https://drive.google.com/file/d/' + this.id; }
  makeCopy(name, folder) { const f = new DFile(this.drive, name, this.blob, this.kind); f.parent = folder; this.drive.files.set(f.id, f); return f; }
}
class Iter { constructor(a) { this.a = a; this.i = 0; } hasNext() { return this.i < this.a.length; } next() { return this.a[this.i++]; } }
class Folder {
  constructor(drive, name, parent) { this.drive = drive; this.id = newId('folder'); this.name = name; this.parent = parent; this.trashed = false; this.editors = []; }
  getId() { return this.id; }
  getName() { return this.name; }
  isTrashed() { return this.trashed; }
  getUrl() { return 'https://drive.google.com/drive/folders/' + this.id; }
  createFolder(n) { const f = new Folder(this.drive, n, this); this.drive.folders.set(f.id, f); return f; }
  getFoldersByName(n) { return new Iter([...this.drive.folders.values()].filter((f) => f.parent === this && f.name === n && !f.trashed)); }
  createFile(blob) { const f = new DFile(this.drive, blob.getName(), blob); f.parent = this; this.drive.files.set(f.id, f); return f; }
  getFiles() { return new Iter([...this.drive.files.values()].filter((f) => f.parent === this && !f.trashed)); }
  addEditor(e) { this.editors.push(e); return this; }
  removeEditor(e) { this.editors = this.editors.filter((x) => x !== e); return this; }
}

/* -------------------------------------------------------- Utilities etc. */
function formatDate(d, tz, fmt) {
  const parts = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
  if (parts.hour === '24') parts.hour = '00';
  return fmt.replace(/yyyy|MM|dd|HH|mm|ss/g, (t) => ({ yyyy: parts.year, MM: parts.month, dd: parts.day, HH: parts.hour, mm: parts.minute, ss: parts.second })[t]);
}

/** Minimal HtmlService template engine supporting <?= ?>, <?!= ?> and <? ?>. */
function renderTemplate(file, vars, ctx) {
  const src = fs.readFileSync(path.join(SRC, file + '.html'), 'utf8');
  return src.replace(/<\?(!?=)?([\s\S]*?)\?>/g, (m, kind, code) => {
    if (!kind) throw new Error('scriptlet blocks not supported by mock');
    const fn = vm.runInContext('(function(__v){ with(__v){ return (' + code.trim().replace(/;\s*$/, '') + '); } })', ctx);
    const out = String(fn(vars));
    return kind === '!=' ? out : out.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  });
}

/* ------------------------------------------------------------------ main */
function createGas(opts) {
  opts = opts || {};
  const app = {
    spreadsheets: new Map(), formulaWrites: [], calls: { getValues: 0, setValues: 0, appendRow: 0 },
    mail: [], cache: new Map(), props: new Map(), triggers: [], docs: [],
    session: { active: opts.activeUser || '', effective: opts.effectiveUser || 'owner@school.org' },
    lockHeld: false, mailQuota: 100, logs: []
  };
  const drive = { files: new Map(), folders: new Map() };
  const rootFolder = new Folder(drive, 'My Drive', null);
  drive.folders.set(rootFolder.id, rootFolder);

  const SpreadsheetApp = {
    create(name) { const ss = new Spreadsheet(app, name); app.spreadsheets.set(ss.id, ss); const f = new DFile(drive, name, null, 'sheet'); f.id = ss.id; f.parent = rootFolder; drive.files.set(f.id, f); return ss; },
    openById(id) { const ss = app.spreadsheets.get(id); if (!ss) throw new Error('Spreadsheet not found ' + id); return ss; },
    flush() {}
  };
  const DriveApp = {
    getRootFolder: () => rootFolder,
    createFolder: (n) => rootFolder.createFolder(n),
    getFolderById(id) { const f = drive.folders.get(id); if (!f) throw new Error('No folder ' + id); return f; },
    getFileById(id) { const f = drive.files.get(id); if (!f) throw new Error('No file ' + id); return f; }
  };
  const Utilities = {
    formatDate,
    base64Decode(s) { return Array.from(Buffer.from(s, 'base64')).map((b) => (b > 127 ? b - 256 : b)); },
    base64Encode(x) { return (typeof x === 'string' ? Buffer.from(x, 'utf8') : toBuf(x)).toString('base64'); },
    newBlob(data, type, name) { return new Blob(typeof data === 'string' ? Buffer.from(data, 'utf8') : toBuf(data || []), type, name); },
    getUuid: () => crypto.randomUUID(),
    sleep() {}
  };
  const cacheObj = {
    get: (k) => (app.cache.has(k) ? app.cache.get(k) : null),
    put: (k, v) => { if (String(v).length > 100000) throw new Error('Argument too large'); app.cache.set(k, String(v)); },
    putAll: (m) => Object.keys(m).forEach((k) => cacheObj.put(k, m[k])),
    getAll: (ks) => { const o = {}; ks.forEach((k) => { if (app.cache.has(k)) o[k] = app.cache.get(k); }); return o; },
    remove: (k) => app.cache.delete(k),
    removeAll: (ks) => ks.forEach((k) => app.cache.delete(k))
  };
  const propsObj = {
    getProperty: (k) => (app.props.has(k) ? app.props.get(k) : null),
    setProperty: (k, v) => { app.props.set(k, String(v)); return propsObj; },
    setProperties: (o) => { Object.keys(o).forEach((k) => app.props.set(k, String(o[k]))); return propsObj; },
    getProperties: () => Object.fromEntries(app.props),
    deleteProperty: (k) => { app.props.delete(k); return propsObj; }
  };
  const lock = {
    tryLock() { if (app.lockHeld) return false; app.lockHeld = true; return true; },
    waitLock() { if (!lock.tryLock()) throw new Error('Lock timeout'); },
    releaseLock() { app.lockHeld = false; },
    hasLock: () => app.lockHeld
  };
  const docBody = () => {
    const tables = [];
    return chain({
      appendTable(rows) { const t = chain({ getNumRows: () => rows.length, getRow: () => chain({ getCell: () => chain({}) }) }); tables.push(rows); return t; },
      appendImage() { return chain({ getWidth: () => 400, getHeight: () => 300 }); },
      _tables: tables
    });
  };
  const DocumentApp = {
    ParagraphHeading: { TITLE: 'T', SUBTITLE: 'S', HEADING1: 'H1', HEADING2: 'H2' },
    HorizontalAlignment: { CENTER: 'C' },
    create(name) {
      const body = docBody();
      const f = new DFile(drive, name, new Blob(Buffer.from('doc'), 'application/vnd.google-apps.document', name), 'doc');
      f.parent = rootFolder; drive.files.set(f.id, f);
      const doc = { getId: () => f.id, getBody: () => body, saveAndClose() {}, _body: body, name };
      app.docs.push(doc);
      return doc;
    }
  };
  const ScriptApp = {
    getProjectTriggers: () => app.triggers.slice(),
    newTrigger(fn) {
      const b = chain({ create() { const uid = newId('trig'); const t = { getHandlerFunction: () => fn, getUniqueId: () => uid }; app.triggers.push(t); return t; } });
      return b;
    },
    getOAuthToken: () => 'mock-token'
  };
  const UrlFetchApp = { fetch: () => ({ getResponseCode: () => 200, getBlob: () => new Blob(Buffer.from('PK-xlsx'), 'application/octet-stream', 'x.xlsx') }) };
  const MailApp = { sendEmail(o) { app.mail.push(o); app.mailQuota--; }, getRemainingDailyQuota: () => app.mailQuota };
  const Session = {
    getActiveUser: () => ({ getEmail: () => app.session.active }),
    getEffectiveUser: () => ({ getEmail: () => app.session.effective })
  };
  const quietConsole = {
    log: (...a) => app.logs.push(['log', a.join(' ')]), warn: (...a) => app.logs.push(['warn', a.join(' ')]),
    error: (...a) => app.logs.push(['error', a.join(' ')]), info: () => {}
  };

  const ctx = vm.createContext({
    SpreadsheetApp, DriveApp, Utilities, DocumentApp, ScriptApp, UrlFetchApp, MailApp, Session,
    CacheService: { getScriptCache: () => cacheObj },
    PropertiesService: { getScriptProperties: () => propsObj },
    LockService: { getScriptLock: () => lock },
    Logger: { log: () => {} },
    Date, // share the host Date so instanceof checks agree across realms
    console: opts.verbose ? console : quietConsole,
    HtmlService: null
  });
  ctx.HtmlService = {
    XFrameOptionsMode: { DEFAULT: 'DEFAULT', ALLOWALL: 'ALLOWALL' },
    createTemplateFromFile(name) {
      const tpl = { evaluate() { const html = renderTemplate(name, tpl, ctx); return chain({ getContent: () => html, _file: name }); } };
      return tpl;
    },
    createHtmlOutputFromFile(name) { const html = fs.readFileSync(path.join(SRC, name + '.html'), 'utf8'); return chain({ getContent: () => html }); },
    createHtmlOutput(html) { return chain({ getContent: () => html }); }
  };

  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.gs')).sort();
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f }));

  return {
    ctx, app, drive, lock,
    /** Run a top-level GAS expression/function. */
    run(code) { return vm.runInContext(code, ctx); },
    call(fn, ...args) {
      const f = vm.runInContext(fn, ctx);
      const r = f.apply(null, args);
      try { return structuredClone(r); } catch (e) { return r; } // host-realm copy for deepEqual
    },
    as(email) { app.session.active = email || ''; return this; },
    resetRequestState() { vm.runInContext('__ss = null; __settings = null;', ctx); },
    sheet(name) { const id = app.props.get('SPREADSHEET_ID'); return app.spreadsheets.get(id).getSheetByName(name); }
  };
}

module.exports = { createGas, Blob };
