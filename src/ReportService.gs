/**
 * ReportService.gs
 * ---------------------------------------------------------------------------
 * Individual alumni reports (Google Docs + PDF) and CSV / Excel exports.
 */

/** Columns never included in exports (internal file references). */
const EXPORT_EXCLUDE = Object.freeze(['photoFileId']);

/**
 * Keeps only short string labels for known keys (labels come from the
 * admin's browser so that reports use the central translation dictionary).
 */
function sanitiseLabels_(labels) {
  const out = { fields: {}, groups: {}, options: {}, title: '', generated: '', yes: 'YES', no: 'NO' };
  if (!labels || typeof labels !== 'object') return out;
  const s = function (v) { return cleanText_(v).slice(0, 200); };
  const keys = masterIndex_();
  Object.keys(labels.fields || {}).forEach(function (k) { if (keys[k] !== undefined) out.fields[k] = s(labels.fields[k]); });
  Object.keys(labels.groups || {}).forEach(function (k) { if (/^[a-z]{2,20}$/.test(k)) out.groups[k] = s(labels.groups[k]); });
  Object.keys(labels.options || {}).slice(0, 200).forEach(function (k) { if (/^[A-Za-z_.]{2,60}$/.test(k)) out.options[k] = s(labels.options[k]); });
  ['title', 'generated', 'yes', 'no'].forEach(function (k) { if (labels[k]) out[k] = s(labels[k]); });
  return out;
}

function displayValue_(key, value, L) {
  if (value === '' || value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? L.yes : L.no;
  const optKey = key + '.' + value;
  if (L.options[optKey]) return L.options[optKey];
  if (/^\d{4}-\d{2}-\d{2}T/.test(String(value))) {
    return Utilities.formatDate(new Date(value), APP.TIMEZONE, 'dd-MM-yyyy HH:mm');
  }
  return String(value);
}

/**
 * Creates a Google Doc report (and a PDF copy) in Generated_Reports/.
 * @return {{docId, docUrl, pdfId, pdfUrl, name}}
 */
function generateAlumniReport_(record, rawLabels, actor) {
  const L = sanitiseLabels_(rawLabels);
  const s = getSettings_();
  const name = 'Alumni_Report_' + record.registrationId + '_' + Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyyMMdd_HHmm');
  const doc = DocumentApp.create(name);
  const body = doc.getBody();
  body.setMarginTop(36).setMarginBottom(36);

  body.appendParagraph(s.SCHOOL_NAME_EN || APP.NAME).setHeading(DocumentApp.ParagraphHeading.TITLE)
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  body.appendParagraph((L.title || 'Alumni Profile') + ' · 1928 – 2028')
    .setHeading(DocumentApp.ParagraphHeading.SUBTITLE).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  body.appendParagraph(record.registrationId + ' — ' + record.fullName)
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  if (record.photoFileId) {
    try {
      const img = body.appendImage(DriveApp.getFileById(record.photoFileId).getBlob());
      const w = img.getWidth(), h = img.getHeight();
      const scale = Math.min(1, 140 / Math.max(w, h));
      img.setWidth(Math.round(w * scale)).setHeight(Math.round(h * scale));
    } catch (e) { console.warn('report photo: ' + e); }
  }

  const groups = ['personal', 'school', 'contact', 'location', 'profession', 'achievements', 'participation', 'consent', 'meta'];
  groups.forEach(function (g) {
    const rows = MASTER_SCHEMA.filter(function (c) { return c.group === g && EXPORT_EXCLUDE.indexOf(c.key) === -1; })
      .map(function (c) { return [L.fields[c.key] || c.header, displayValue_(c.key, record[c.key], L)]; });
    if (!rows.length) return;
    body.appendParagraph(L.groups[g] || g).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    const table = body.appendTable(rows);
    table.setBorderColor('#d9cba3');
    for (let i = 0; i < table.getNumRows(); i++) {
      table.getRow(i).getCell(0).setWidth(170).setBackgroundColor('#f7f1e3');
    }
  });

  body.appendParagraph((L.generated || 'Generated') + ': ' +
    Utilities.formatDate(new Date(), APP.TIMEZONE, 'dd-MM-yyyy HH:mm') + ' · ' + actor)
    .setFontSize(8).setForegroundColor('#777777');
  doc.saveAndClose();

  const folder = getFolder_(PROP.REPORTS_FOLDER_ID);
  const docFile = DriveApp.getFileById(doc.getId());
  docFile.moveTo(folder);
  const pdf = folder.createFile(docFile.getAs('application/pdf')).setName(name + '.pdf');
  return { name: name, docId: docFile.getId(), docUrl: docFile.getUrl(), pdfId: pdf.getId(), pdfUrl: pdf.getUrl() };
}

/* ---------------------------------------------------------------- export */

function exportColumns_() {
  return MASTER_SCHEMA.filter(function (c) { return EXPORT_EXCLUDE.indexOf(c.key) === -1; });
}

/** CSV cell: quoted, and neutralised against spreadsheet formula injection. */
function csvCell_(v) {
  let s = v === null || v === undefined ? '' : (typeof v === 'boolean' ? (v ? 'YES' : 'NO') : String(v));
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function buildCsv_(records) {
  const cols = exportColumns_();
  const lines = [cols.map(function (c) { return csvCell_(c.header); }).join(',')];
  records.forEach(function (r) {
    lines.push(cols.map(function (c) { return csvCell_(r[c.key]); }).join(','));
  });
  return '﻿' + lines.join('\r\n'); // BOM so Excel shows Gujarati / Hindi correctly
}

/**
 * Exports records to Exports/ as CSV or XLSX.
 * @return {{name, fileId, url, mimeType, base64, count}}
 */
function exportRecords_(records, format, actor) {
  const stamp = Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyyMMdd_HHmmss');
  const folder = getFolder_(PROP.EXPORTS_FOLDER_ID);
  let blob;
  if (format === 'xlsx') {
    const cols = exportColumns_();
    const values = [cols.map(function (c) { return c.header; })].concat(records.map(function (r) {
      return cols.map(function (c) {
        const v = r[c.key];
        return typeof v === 'boolean' ? (v ? 'YES' : 'NO') : cellSafe_(v);
      });
    }));
    const tmp = SpreadsheetApp.create('tmp_export_' + stamp);
    const sh = tmp.getSheets()[0].setName('Alumni');
    if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
    if (sh.getMaxRows() < values.length) sh.insertRowsAfter(sh.getMaxRows(), values.length - sh.getMaxRows());
    sh.getRange(1, 1, values.length, cols.length).setValues(values);
    sh.getRange(1, 1, 1, cols.length).setFontWeight('bold');
    sh.setFrozenRows(1);
    SpreadsheetApp.flush();
    const resp = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + tmp.getId() + '/export?format=xlsx', {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
    });
    DriveApp.getFileById(tmp.getId()).setTrashed(true);
    if (resp.getResponseCode() !== 200) throw appError_('EXPORT_FAILED');
    blob = resp.getBlob().setName('Alumni_Export_' + stamp + '.xlsx')
      .setContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  } else {
    blob = Utilities.newBlob('', 'text/csv', 'Alumni_Export_' + stamp + '.csv').setDataFromString(buildCsv_(records), 'UTF-8');
  }
  const file = folder.createFile(blob);
  logActivity_('EXPORT', '', actor, 'SUCCESS', { format: format, rows: records.length, file: file.getName() });
  return {
    name: file.getName(), fileId: file.getId(), url: file.getUrl(), mimeType: blob.getContentType(),
    base64: Utilities.base64Encode(blob.getBytes()), count: records.length
  };
}
