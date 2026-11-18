/**
 * DriveService.gs
 * ---------------------------------------------------------------------------
 * Google Drive folder structure, photo storage and backups.
 *
 *   School_Centenary_2028/
 *     ├─ Centenary_2028_Alumni_Database (spreadsheet)
 *     ├─ Alumni_Photos/
 *     ├─ Generated_Reports/
 *     ├─ Exports/
 *     └─ Backups/
 *
 * Files are private (owner + explicitly added admins). Only Drive file IDs are
 * stored in the sheet – never public sharing links.
 */

function getOrCreateChildFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** Creates the folder tree (idempotent) and stores IDs in Script Properties. */
function ensureFolderStructure_() {
  const p = props_();
  let root = null;
  const rootId = p.getProperty(PROP.ROOT_FOLDER_ID);
  if (rootId) {
    try { root = DriveApp.getFolderById(rootId); if (root.isTrashed()) root = null; } catch (e) { root = null; }
  }
  if (!root) {
    const it = DriveApp.getRootFolder().getFoldersByName(FOLDERS.ROOT);
    root = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDERS.ROOT);
  }
  const ids = {};
  ids[PROP.ROOT_FOLDER_ID] = root.getId();
  ids[PROP.PHOTOS_FOLDER_ID] = getOrCreateChildFolder_(root, FOLDERS.PHOTOS).getId();
  ids[PROP.REPORTS_FOLDER_ID] = getOrCreateChildFolder_(root, FOLDERS.REPORTS).getId();
  ids[PROP.EXPORTS_FOLDER_ID] = getOrCreateChildFolder_(root, FOLDERS.EXPORTS).getId();
  ids[PROP.BACKUPS_FOLDER_ID] = getOrCreateChildFolder_(root, FOLDERS.BACKUPS).getId();
  p.setProperties(ids);
  return root;
}

function getFolder_(propKey) {
  const id = props_().getProperty(propKey);
  if (!id) throw appError_('NOT_CONFIGURED');
  return DriveApp.getFolderById(id);
}

/** Saves a validated photo (see validatePhoto_) and returns its Drive file ID. */
function savePhoto_(photo, baseName) {
  const blob = Utilities.newBlob(photo.bytes, photo.mimeType, baseName + '.' + photo.ext);
  const file = getFolder_(PROP.PHOTOS_FOLDER_ID).createFile(blob);
  file.setDescription('Alumni profile photograph – stored with consent. Do not share publicly.');
  return file.getId();
}

function renameFile_(fileId, name) {
  try { DriveApp.getFileById(fileId).setName(name); } catch (e) { console.warn('renameFile_: ' + e); }
}

function trashFile_(fileId) {
  try { if (fileId) DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { console.warn('trashFile_: ' + e); }
}

/** Returns a data: URL so admins can view a photo without any public link. */
function getPhotoDataUrl_(fileId) {
  if (!fileId) return '';
  try {
    const blob = DriveApp.getFileById(fileId).getBlob();
    return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
  } catch (e) {
    console.warn('getPhotoDataUrl_: ' + e);
    return '';
  }
}

/** Copies the database spreadsheet into Backups/ and prunes old copies. */
function runBackup_() {
  const ssId = props_().getProperty(PROP.SPREADSHEET_ID);
  if (!ssId) throw appError_('NOT_CONFIGURED');
  const folder = getFolder_(PROP.BACKUPS_FOLDER_ID);
  const stamp = Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy-MM-dd_HHmm');
  const copy = DriveApp.getFileById(ssId).makeCopy('Backup_' + SPREADSHEET_NAME + '_' + stamp, folder);

  const keep = Math.max(3, Number(getSettings_().BACKUP_RETENTION) || APP.BACKUP_RETENTION_DEFAULT);
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf('Backup_') === 0) files.push(f);
  }
  files.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  let removed = 0;
  files.slice(keep).forEach(function (f) { f.setTrashed(true); removed++; });
  logActivity_('BACKUP', '', 'system', 'SUCCESS', { file: copy.getName(), pruned: removed });
  return { fileId: copy.getId(), name: copy.getName(), pruned: removed };
}

/** Gives an admin edit access to the portal folder (spreadsheet lives inside). */
function shareWithAdmin_(email) {
  const root = getFolder_(PROP.ROOT_FOLDER_ID);
  root.addEditor(email);
  const ssId = props_().getProperty(PROP.SPREADSHEET_ID);
  if (ssId) SpreadsheetApp.openById(ssId).addEditor(email);
}
