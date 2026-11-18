'use strict';
/* Backend tests: run the real .gs sources against the in-memory GAS mock. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { freshPortal, payload, assertTransportSafe, OWNER, JPEG, PNG, createGas } = require('./helpers');

const MASTER = 'Alumni_Master';
const submit = (gas, p) => { gas.resetRequestState(); return assertTransportSafe(gas.call('submitRegistration', p), 'submitRegistration'); };
const masterRows = (gas) => { const sh = gas.sheet(MASTER); return sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, sh.getMaxColumns()).getValues(); };
const col = (gas, key) => gas.run(`masterIndex_()['${key}']`);
const setSetting = (gas, key, value) => {
  const sh = gas.sheet('Settings');
  const keys = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map((r) => r[0]);
  const i = keys.indexOf(key);
  assert.ok(i >= 0, 'setting ' + key);
  sh.getRange(i + 2, 2).setValue(value);
  gas.app.cache.clear();
  gas.resetRequestState();
};
const addAdmin = (gas, email, role, active) => {
  gas.sheet('Admin_Users').appendRow([email, 'Test', role, active === false ? 'FALSE' : 'TRUE', new Date(), '']);
};

/* ================================================================= setup */
test('setup() creates folders, 7 sheets with headers, owner admin, trigger', () => {
  const gas = freshPortal();
  const p = gas.app.props;
  for (const k of ['SPREADSHEET_ID', 'ROOT_FOLDER_ID', 'PHOTOS_FOLDER_ID', 'REPORTS_FOLDER_ID', 'EXPORTS_FOLDER_ID', 'BACKUPS_FOLDER_ID', 'OWNER_EMAIL']) {
    assert.ok(p.get(k), 'missing property ' + k);
  }
  const folderNames = [...gas.drive.folders.values()].map((f) => f.name).sort();
  assert.deepEqual(folderNames, ['Alumni_Photos', 'Backups', 'Exports', 'Generated_Reports', 'My Drive', 'School_Centenary_2028']);
  const ss = gas.app.spreadsheets.get(p.get('SPREADSHEET_ID'));
  assert.deepEqual(ss.getSheets().map((s) => s.getName()).sort(),
    ['Admin_Users', 'Alumni_Master', 'Batch_Summary', 'Countries_Summary', 'Occupation_Summary', 'Registration_Logs', 'Settings']);
  assert.equal(gas.drive.files.get(ss.getId()).parent.name, 'School_Centenary_2028', 'spreadsheet lives in portal folder');
  const headers = gas.sheet(MASTER).getRange(1, 1, 1, 54).getValues()[0];
  assert.equal(headers[1], 'Registration ID');
  assert.equal(headers.filter(Boolean).length, 54);
  const admins = gas.sheet('Admin_Users').getRange(2, 1, 1, 4).getValues()[0];
  assert.deepEqual(admins.slice(0, 4), [OWNER, 'Project Owner', 'SUPER_ADMIN', 'TRUE']);
  assert.equal(gas.app.triggers.length, 1);
  assert.equal(gas.app.triggers[0].getHandlerFunction(), 'dailyMaintenance');
  assert.ok(gas.sheet('Settings').getLastRow() > 10);
  assert.ok(gas.sheet('Admin_Users').protected && gas.sheet('Settings').protected);
});

test('setup() is idempotent and keeps data', () => {
  const gas = freshPortal();
  assert.equal(submit(gas, payload()).ok, true);
  gas.as(OWNER); gas.resetRequestState(); gas.call('setup'); gas.as('');
  assert.equal(masterRows(gas).length, 1);
  assert.equal(gas.sheet('Admin_Users').getLastRow(), 2);
  assert.equal(gas.app.triggers.length, 1);
  assert.equal(gas.app.spreadsheets.size, 1);
  assert.equal(submit(gas, payload({ fullName: 'Second Person', mobileNumber: '9123456780', email: 'b@x.org' })).registrationId, 'ALM-2028-000002');
});

test('setup()/addAdmin()/dailyMaintenance() refuse anonymous web callers', () => {
  const gas = freshPortal();
  gas.as('');
  assert.throws(() => gas.call('setup'), /Owner only/);
  assert.throws(() => gas.call('addAdmin', 'evil@x.com', 'x', 'SUPER_ADMIN'), /Owner only/);
  assert.throws(() => gas.call('dailyMaintenance', { triggerUid: 'forged' }), /Owner only/);
  gas.as('other@gmail.com');
  assert.throws(() => gas.call('setup'), /Owner only/, 'active != effective user');
});

test('doGet renders pages without leaking spreadsheet / folder IDs', () => {
  const gas = freshPortal();
  const home = gas.call('doGet', { parameter: {} }).getContent();
  const admin = gas.call('doGet', { parameter: { page: 'admin' } }).getContent();
  for (const html of [home, admin]) {
    for (const [k, v] of gas.app.props) {
      if (k === 'REG_SEQ') continue;
      assert.ok(!html.includes(v), `page leaks ${k}`);
    }
    assert.ok(html.includes('window.APP_BOOT = {'), 'bootstrap injected');
    assert.ok(!/<\?/.test(html), 'all scriptlets evaluated');
  }
  assert.ok(home.includes('id="regForm"'));
  assert.ok(admin.includes('id="admApp"'));
  assert.throws(() => gas.call('include', 'Code'), /Not includable/);
});

test('doGet before setup shows a setup-pending page', () => {
  const gas = createGas({ activeUser: '' });
  assert.match(gas.call('doGet', { parameter: {} }).getContent(), /setup pending/i);
  assert.deepEqual(gas.call('submitRegistration', payload()), { ok: false, code: 'NOT_CONFIGURED' });
});

/* ========================================================== registration */
test('valid submission is stored with ID, normalised data and consent records', () => {
  const gas = freshPortal();
  const res = submit(gas, payload({ postalCode: '00123' }));
  assert.equal(res.ok, true);
  assert.equal(res.registrationId, 'ALM-2028-000001');
  assert.equal(res.emailSent, true);
  const rows = masterRows(gas);
  assert.equal(rows.length, 1);
  const r = rows[0];
  const v = (k) => r[col(gas, k)];
  assert.ok(v('timestamp') instanceof Date);
  assert.equal(v('registrationId'), 'ALM-2028-000001');
  assert.equal(v('mobile'), '+919876543210', 'E.164 kept as text');
  assert.equal(v('whatsapp'), '+919876543210');
  assert.equal(v('email'), 'ramesh.patel@example.com', 'email lower-cased');
  assert.equal(v('postalCode'), '00123', 'leading zeros kept');
  assert.equal(v('dob'), '1975-04-12', 'date-like text not converted');
  assert.equal(v('admissionYear'), 1981);
  assert.equal(v('country'), 'India');
  assert.equal(v('website'), 'https://example.org');
  assert.equal(v('consentStore'), 'YES');
  assert.equal(v('consentDirectory'), 'YES');
  assert.equal(v('consentPhoto'), 'NO');
  assert.equal(v('moderation'), 'PENDING');
  assert.ok(v('consentTimestamp') instanceof Date);
  assert.equal(v('privacyVersion'), gas.run('APP.PRIVACY_VERSION'));
  assert.equal(v('altPhone'), '');
  assert.equal(gas.app.formulaWrites.length, 0);

  // summaries
  assert.deepEqual(gas.sheet('Countries_Summary').getRange(2, 1, 1, 3).getValues()[0], ['IN', 'India', 1]);
  assert.deepEqual(gas.sheet('Occupation_Summary').getRange(2, 1, 1, 3).getValues()[0], ['DOCTOR', 'Doctor', 1]);
  assert.deepEqual(gas.sheet('Batch_Summary').getRange(2, 1, 1, 2).getValues()[0], [1991, 1]);
  // log + email
  const logs = gas.sheet('Registration_Logs').getRange(2, 1, gas.sheet('Registration_Logs').getLastRow() - 1, 5).getValues();
  assert.ok(logs.some((l) => l[1] === 'REGISTER' && l[2] === 'ALM-2028-000001' && l[4] === 'SUCCESS'));
  assert.equal(gas.app.mail.length, 1);
  assert.equal(gas.app.mail[0].to, 'ramesh.patel@example.com');
  assert.match(gas.app.mail[0].subject, /ALM-2028-000001/);
  assert.match(gas.app.mail[0].htmlBody, /તમારી માહિતી સફળતાપૂર્વક નોંધાઈ ગઈ છે/);
});

test('Hindi submission gets Hindi confirmation email; email can be disabled', () => {
  const gas = freshPortal();
  submit(gas, payload({ language: 'hi' }));
  assert.match(gas.app.mail[0].htmlBody, /आपकी जानकारी सफलतापूर्वक दर्ज हो गई है/);
  setSetting(gas, 'SEND_CONFIRMATION_EMAIL', 'FALSE');
  const r = submit(gas, payload({ fullName: 'Other Person', mobileNumber: '9000000001', email: 'o@x.org' }));
  assert.equal(r.emailSent, false);
  assert.equal(gas.app.mail.length, 1);
});

test('IDs are sequential and unique across many submissions', () => {
  const gas = freshPortal();
  const ids = [];
  for (let i = 0; i < 25; i++) {
    const r = submit(gas, payload({ fullName: 'Person ' + String.fromCharCode(65 + i), mobileNumber: '90000000' + String(i).padStart(2, '0'), email: `p${i}@x.org` }));
    assert.equal(r.ok, true, JSON.stringify(r));
    ids.push(r.registrationId);
  }
  assert.equal(new Set(ids).size, 25);
  assert.equal(ids[24], 'ALM-2028-000025');
  assert.equal(gas.app.lockHeld, false, 'lock released');
});

test('ID sequence recovers from existing rows if the counter property is lost', () => {
  const gas = freshPortal();
  submit(gas, payload());
  submit(gas, payload({ fullName: 'B Person', mobileNumber: '9111111111', email: 'b@x.org' }));
  gas.app.props.delete('REG_SEQ');
  const r = submit(gas, payload({ fullName: 'C Person', mobileNumber: '9222222222', email: 'c@x.org' }));
  assert.equal(r.registrationId, 'ALM-2028-000003');
});

test('resubmitting the same token is idempotent (no duplicate row)', () => {
  const gas = freshPortal();
  const p = payload();
  const a = submit(gas, p);
  const b = submit(gas, p);
  assert.equal(b.ok, true);
  assert.equal(b.registrationId, a.registrationId);
  assert.equal(b.repeated, true);
  assert.equal(masterRows(gas).length, 1);
});

test('hard duplicates are rejected: same name + mobile / email / batch', () => {
  const gas = freshPortal();
  submit(gas, payload());
  const sameMobile = submit(gas, payload({ fullName: 'રમેશ  કાંતિલાલ   પટેલ', email: 'new@x.org', admissionYear: '1980' }));
  assert.equal(sameMobile.code, 'DUPLICATE');
  assert.deepEqual(sameMobile.fields, ['mobile']);
  const sameEmail = submit(gas, payload({ mobileNumber: '9000011111', email: 'RAMESH.PATEL@example.com', admissionYear: '1980' }));
  assert.equal(sameEmail.code, 'DUPLICATE');
  assert.ok(sameEmail.fields.includes('email'));
  const sameBatch = submit(gas, payload({ mobileNumber: '9000022222', email: 'z@x.org' }));
  assert.equal(sameBatch.code, 'DUPLICATE');
  assert.ok(sameBatch.fields.includes('nameBatch'));
  assert.equal(masterRows(gas).length, 1);
});

test('soft duplicate (sibling sharing a family number) is accepted and flagged', () => {
  const gas = freshPortal();
  const a = submit(gas, payload());
  const b = submit(gas, payload({ fullName: 'Suresh Kantilal Patel', email: 'suresh@x.org' }));
  assert.equal(b.ok, true);
  const row = masterRows(gas)[1];
  assert.equal(row[col(gas, 'possibleDuplicateOf')], a.registrationId);
});

test('server-side validation rejects bad input with field codes', () => {
  const gas = freshPortal();
  const r = submit(gas, payload({
    fullName: '', gender: 'ALIEN', mobileNumber: '12345', email: 'not-an-email', admissionYear: '1990', leavingYear: '1985',
    countryCode: 'ZZ', occupation: 'ENGINEER', organization: '', consentPrivacy: false, attendCentenary: '', website: 'javascript:alert(1)',
    postalCode: '<script>', dob: '2099-01-01', lastStandard: '13', achievements: 'x'.repeat(1001)
  }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'VALIDATION');
  assert.deepEqual(r.errors, {
    fullName: 'required', gender: 'invalid', dob: 'invalid', leavingYear: 'yearOrder', lastStandard: 'invalid',
    mobile: 'phoneInvalid', email: 'emailInvalid', countryCode: 'invalid', postalCode: 'invalid',
    organization: 'required', website: 'invalid', achievements: 'tooLong', attendCentenary: 'required',
    consentPrivacy: 'consentRequired'
  });
  assert.equal(masterRows(gas).length, 0);
});

test('occupation rules: OTHER needs description; farmer needs no employer', () => {
  const gas = freshPortal();
  let r = submit(gas, payload({ occupation: 'OTHER', occupationOther: '', organization: '', designation: '', professionalField: '' }));
  assert.deepEqual(r.errors, { occupationOther: 'required' });
  r = submit(gas, payload({ occupation: 'FARMER', organization: '', designation: '', professionalField: '' }));
  assert.equal(r.ok, true);
});

test('international phone numbers with country codes are normalised', () => {
  const gas = freshPortal();
  const r = submit(gas, payload({ mobileCountry: 'US', mobileNumber: '(415) 555-0132', whatsappCountry: 'GB', whatsappNumber: '+44 7700 900123',
    altPhoneCountry: 'AE', altPhoneNumber: '050 123 4567', countryCode: 'US', state: 'California', city: 'San Jose', postalCode: '95112' }));
  assert.equal(r.ok, true, JSON.stringify(r));
  const row = masterRows(gas)[0];
  assert.equal(row[col(gas, 'mobile')], '+14155550132');
  assert.equal(row[col(gas, 'whatsapp')], '+447700900123');
  assert.equal(row[col(gas, 'altPhone')], '+971501234567');
  const bad = submit(gas, payload({ fullName: 'X Y', mobileCountry: 'GB', mobileNumber: '+91 9876543210' }));
  assert.equal(bad.errors.mobile, 'phoneInvalid', 'number with mismatching country code rejected');
});

test('formula / script injection is stored as inert text', () => {
  const gas = freshPortal();
  const r = submit(gas, payload({ city: '=IMPORTXML("http://evil","//a")', state: '+cmd|calc', schoolMemory: '<img src=x onerror=alert(1)>' }));
  assert.equal(r.ok, true);
  assert.equal(gas.app.formulaWrites.length, 0);
  const row = masterRows(gas)[0];
  assert.equal(row[col(gas, 'city')], '=IMPORTXML("http://evil","//a")');
  assert.equal(row[col(gas, 'state')], '+cmd|calc');
});

test('honeypot, closed registration and malformed tokens are rejected', () => {
  const gas = freshPortal();
  assert.equal(submit(gas, payload({ hp: 'http://spam' })).code, 'VALIDATION');
  assert.equal(submit(gas, payload({ submissionToken: 'short' })).code, 'VALIDATION');
  assert.equal(submit(gas, null).code, 'VALIDATION');
  setSetting(gas, 'REGISTRATION_OPEN', 'FALSE');
  assert.equal(submit(gas, payload()).code, 'CLOSED');
  assert.equal(masterRows(gas).length, 0);
});

test('photo upload: stored only with consent, verified by signature and size', () => {
  const gas = freshPortal();
  const photo = { name: 'me.jpg', mimeType: 'image/jpeg', data: JPEG.toString('base64') };
  // no consent → rejected
  let r = submit(gas, payload({ photo, consentPhoto: false }));
  assert.deepEqual(r.errors, { consentPhoto: 'consentRequired' });
  // PNG bytes declared as JPEG → rejected
  r = submit(gas, payload({ photo: { mimeType: 'image/jpeg', data: PNG.toString('base64') }, consentPhoto: true }));
  assert.deepEqual(r.errors, { photo: 'fileType' });
  // disallowed type
  r = submit(gas, payload({ photo: { mimeType: 'image/gif', data: PNG.toString('base64') }, consentPhoto: true }));
  assert.deepEqual(r.errors, { photo: 'fileType' });
  // too large
  const big = Buffer.concat([JPEG.subarray(0, 4), Buffer.alloc(3 * 1024 * 1024)]);
  r = submit(gas, payload({ photo: { mimeType: 'image/jpeg', data: big.toString('base64') }, consentPhoto: true }));
  assert.deepEqual(r.errors, { photo: 'fileSize' });
  assert.equal([...gas.drive.files.values()].filter((f) => f.parent && f.parent.name === 'Alumni_Photos').length, 0);
  // valid
  r = submit(gas, payload({ photo, consentPhoto: true }));
  assert.equal(r.ok, true);
  const row = masterRows(gas)[0];
  const fid = row[col(gas, 'photoFileId')];
  const file = gas.drive.files.get(fid);
  assert.equal(file.parent.name, 'Alumni_Photos');
  assert.equal(file.getName(), r.registrationId + '.jpg');
  assert.equal(row[col(gas, 'consentPhoto')], 'YES');
  assert.ok(!/https?:/.test(fid), 'only the Drive file ID is stored');
});

test('lock contention returns BUSY and cleans up the uploaded photo', () => {
  const gas = freshPortal();
  gas.app.lockHeld = true; // another execution holds the lock
  const r = submit(gas, payload({ photo: { mimeType: 'image/jpeg', data: JPEG.toString('base64') }, consentPhoto: true }));
  assert.equal(r.code, 'BUSY');
  const photos = [...gas.drive.files.values()].filter((f) => f.parent && f.parent.name === 'Alumni_Photos');
  assert.equal(photos.length, 1);
  assert.equal(photos[0].isTrashed(), true);
  assert.equal(masterRows(gas).length, 0);
  gas.app.lockHeld = false;
  assert.equal(submit(gas, payload()).ok, true);
});

test('unexpected server errors are caught, logged and returned as SERVER', () => {
  const gas = freshPortal();
  gas.run('const __orig = appendMasterRecord_; appendMasterRecord_ = function(){ throw new Error("Sheets down"); }');
  const r = submit(gas, payload());
  assert.deepEqual(r, { ok: false, code: 'SERVER' });
  assert.equal(gas.app.lockHeld, false, 'lock released after error');
  const logs = gas.sheet('Registration_Logs').getRange(2, 1, gas.sheet('Registration_Logs').getLastRow() - 1, 6).getValues();
  assert.ok(logs.some((l) => l[1] === 'ERROR' && /Sheets down/.test(l[5])));
});

/* ============================================================ public data */
test('public stats use real aggregated data only', () => {
  const gas = freshPortal();
  let s = gas.call('getPublicStats');
  assert.equal(s.total, 0);
  submit(gas, payload());
  submit(gas, payload({ fullName: 'A Abroad', mobileNumber: '9000000002', email: 'a@x.org', countryCode: 'CA', state: 'Ontario', city: 'Toronto', leavingYear: '2005', admissionYear: '1995' }));
  submit(gas, payload({ fullName: 'B Abroad', mobileNumber: '9000000003', email: 'b@x.org', countryCode: 'CA', state: 'Ontario', city: 'Toronto', leavingYear: '2006', admissionYear: '1996' }));
  gas.resetRequestState();
  s = assertTransportSafe(gas.call('getPublicStats'), 'stats');
  assert.equal(s.total, 3);
  assert.equal(s.india, 1);
  assert.equal(s.abroad, 2);
  assert.equal(s.countriesCount, 2);
  assert.deepEqual(s.byCountry, [['CA', 2], ['IN', 1]]);
  assert.deepEqual(s.byDecade, [[1990, 1], [2000, 2]]);
  assert.ok(!JSON.stringify(s).includes('Patel'), 'no personal data in public stats');
});

test('public directory/memories show only consented AND approved alumni', () => {
  const gas = freshPortal();
  const a = submit(gas, payload());
  submit(gas, payload({ fullName: 'No Consent', mobileNumber: '9000000004', email: 'n@x.org', consentDirectory: false }));
  gas.resetRequestState();
  assert.equal(gas.call('getPublicDirectory', {}).total, 0, 'pending not shown');
  gas.as(OWNER);
  assert.equal(gas.call('adminSetModeration', a.registrationId, 'APPROVED').ok, true);
  const noConsentId = 'ALM-2028-000002';
  assert.equal(gas.call('adminSetModeration', noConsentId, 'APPROVED').code, 'NO_CONSENT');
  gas.as(''); gas.resetRequestState();
  const d = assertTransportSafe(gas.call('getPublicDirectory', { q: 'પટેલ' }), 'dir');
  assert.equal(d.total, 1);
  assert.deepEqual(Object.keys(d.rows[0]).sort(), ['city', 'country', 'name', 'occupation', 'year']);
  assert.ok(!JSON.stringify(d).includes('9876543210') && !JSON.stringify(d).includes('@'), 'no contact data public');
  const m = gas.call('getPublicMemories');
  assert.equal(m.rows.length, 1);
  assert.match(m.rows[0].memory, /banyan/);
});

/* ================================================================== admin */
test('admin API denies anonymous, unknown and inactive accounts', () => {
  const gas = freshPortal();
  submit(gas, payload());
  const fns = [['adminGetContext'], ['adminGetDashboard'], ['adminSearch', {}], ['adminGetProfile', 'ALM-2028-000001'],
    ['adminUpdateProfile', 'ALM-2028-000001', { city: 'X' }], ['adminExport', {}, 'csv'], ['adminGetActivity', 10],
    ['adminDeleteRecord', 'ALM-2028-000001', 'ALM-2028-000001'], ['adminRunBackup'], ['adminGetTools'], ['adminGenerateReport', 'ALM-2028-000001', {}]];
  gas.as('');
  fns.forEach(([fn, ...args]) => assert.equal(gas.call(fn, ...args).code, 'NOT_SIGNED_IN', fn));
  gas.as('stranger@gmail.com');
  fns.forEach(([fn, ...args]) => assert.equal(gas.call(fn, ...args).code, 'FORBIDDEN', fn));
  addAdmin(gas, 'former@school.org', 'ADMIN', false);
  gas.as('former@school.org');
  assert.equal(gas.call('adminGetContext').code, 'FORBIDDEN');
  assert.equal(gas.sheet(MASTER).getLastRow(), 2, 'nothing deleted');
  const logs = gas.sheet('Registration_Logs').getRange(2, 1, gas.sheet('Registration_Logs').getLastRow() - 1, 4).getValues();
  assert.ok(logs.filter((l) => l[1] === 'ADMIN_DENIED').length >= fns.length * 2);
});

test('role hierarchy: VIEWER reads, ADMIN edits/exports, SUPER_ADMIN deletes/backups', () => {
  const gas = freshPortal();
  const r = submit(gas, payload());
  addAdmin(gas, 'viewer@school.org', 'VIEWER');
  addAdmin(gas, 'Teacher@School.org', 'ADMIN');
  gas.as('viewer@school.org');
  assert.equal(gas.call('adminGetContext').data.role, 'VIEWER');
  assert.equal(gas.call('adminSearch', {}).data.total, 1);
  assert.equal(gas.call('adminGetProfile', r.registrationId).ok, true);
  assert.equal(gas.call('adminUpdateProfile', r.registrationId, { city: 'Surat' }).code, 'FORBIDDEN');
  assert.equal(gas.call('adminExport', {}, 'csv').code, 'FORBIDDEN');
  gas.as('teacher@school.org');
  assert.equal(gas.call('adminUpdateProfile', r.registrationId, { city: 'Surat' }).ok, true);
  assert.equal(gas.call('adminExport', {}, 'csv').ok, true);
  assert.equal(gas.call('adminDeleteRecord', r.registrationId, r.registrationId).code, 'FORBIDDEN');
  assert.equal(gas.call('adminRunBackup').code, 'FORBIDDEN');
  gas.as(OWNER);
  assert.equal(gas.call('adminRunBackup').ok, true);
});

test('admin dashboard statistics', () => {
  const gas = freshPortal();
  submit(gas, payload());
  submit(gas, payload({ fullName: 'Asha Shah', mobileNumber: '9000000005', email: 'asha@x.org', gender: 'FEMALE', countryCode: 'US', state: 'New Jersey', city: 'Edison', occupation: 'ENGINEER', leavingYear: '2001', admissionYear: '1991', attendCentenary: 'MAYBE' }));
  submit(gas, payload({ fullName: 'Kiran Desai', mobileNumber: '9000000006', email: 'kiran@x.org', city: 'ahmedabad', occupation: 'FARMER', organization: '', designation: '', professionalField: '' }));
  gas.as(OWNER); gas.resetRequestState();
  const s = assertTransportSafe(gas.call('adminGetDashboard'), 'dashboard').data;
  assert.equal(s.total, 3);
  assert.equal(s.india, 2);
  assert.equal(s.abroad, 1);
  assert.equal(s.last7, 3);
  assert.deepEqual(s.byCountry[0], ['IN', 2]);
  assert.deepEqual(s.byCity[0], ['Ahmedabad · IN', 2], 'city grouping is case-insensitive');
  assert.deepEqual(s.byYear, [[1991, 2], [2001, 1]]);
  assert.equal(s.byOccupation.length, 3);
  assert.deepEqual(s.participation.attendCentenary, { YES: 2, NO: 0, MAYBE: 1 });
  assert.equal(s.daily.length, 30);
  assert.equal(s.daily[29][1], 3);
  assert.equal(s.pendingModeration, 3);
});

test('admin search by name, mobile, registration ID, country and batch', () => {
  const gas = freshPortal();
  submit(gas, payload());
  submit(gas, payload({ fullName: 'Asha Shah', mobileNumber: '9000000005', whatsappNumber: '9000000005', email: 'asha@x.org', countryCode: 'US', state: 'NJ', city: 'Edison', leavingYear: '2001', admissionYear: '1991' }));
  gas.as(OWNER);
  const s = (q) => assertTransportSafe(gas.call('adminSearch', q), 'search').data;
  assert.equal(s({ field: 'name', q: 'asha' }).total, 1);
  assert.equal(s({ field: 'name', q: 'પટેલ' }).rows[0].registrationId, 'ALM-2028-000001');
  assert.equal(s({ field: 'mobile', q: '000005' }).rows[0].fullName, 'Asha Shah');
  assert.equal(s({ field: 'mobile', q: '98765 43210' }).total, 1);
  assert.equal(s({ field: 'id', q: 'alm-2028-000002' }).total, 1);
  assert.equal(s({ country: 'US' }).total, 1);
  assert.equal(s({ year: '1991' }).total, 1);
  assert.equal(s({ year: '1991', country: 'US' }).total, 0);
  assert.equal(s({}).total, 2);
  assert.equal(s({}).rows[0].registrationId, 'ALM-2028-000002', 'newest first');
  const page = s({ pageSize: 5, page: 99 });
  assert.equal(page.page, 1);
});

test('admin edit validates, re-checks duplicates, updates summaries and logs fields', () => {
  const gas = freshPortal();
  const a = submit(gas, payload());
  const b = submit(gas, payload({ fullName: 'Asha Shah', mobileNumber: '9000000005', email: 'asha@x.org' }));
  gas.as(OWNER);
  let r = gas.call('adminUpdateProfile', a.registrationId, { email: 'broken' });
  assert.equal(r.code, 'VALIDATION');
  assert.deepEqual(r.extra.errors, { email: 'emailInvalid' });
  r = gas.call('adminUpdateProfile', b.registrationId, { fullName: 'રમેશ કાંતિલાલ પટેલ', mobile: '+919876543210' });
  assert.equal(r.code, 'DUPLICATE', 'cannot edit into a duplicate of another record');
  r = assertTransportSafe(gas.call('adminUpdateProfile', a.registrationId, { countryCode: 'AU', state: 'Victoria', city: 'Melbourne', adminNotes: 'Moved 2020', consentStore: false, registrationId: 'HACK' }), 'update');
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.changed.sort(), ['adminNotes', 'city', 'country', 'countryCode', 'state']);
  const rec = gas.call('adminGetProfile', a.registrationId).data;
  assert.equal(rec.country, 'Australia');
  assert.equal(rec.consentStore, true, 'consent cannot be changed by admins');
  assert.equal(rec.registrationId, a.registrationId);
  assert.equal(rec.updatedBy, OWNER);
  const cs = gas.sheet('Countries_Summary').getRange(2, 1, gas.sheet('Countries_Summary').getLastRow() - 1, 3).getValues();
  assert.deepEqual(cs.map((x) => [x[0], x[2]]).sort(), [['AU', 1], ['IN', 1]]);
  const logs = gas.sheet('Registration_Logs').getRange(2, 1, gas.sheet('Registration_Logs').getLastRow() - 1, 6).getValues();
  const edit = logs.find((l) => l[1] === 'EDIT');
  assert.ok(edit && /city/.test(edit[5]) && !/Melbourne/.test(edit[5]), 'log lists field names, not values');
  r = gas.call('adminUpdateProfile', a.registrationId, {});
  assert.deepEqual(r.data.changed, []);
});

test('export CSV / XLSX to Exports folder with BOM, headers and neutralised formulas', () => {
  const gas = freshPortal();
  submit(gas, payload({ city: '=HYPERLINK("x")', photo: { mimeType: 'image/jpeg', data: JPEG.toString('base64') }, consentPhoto: true }));
  gas.as(OWNER);
  const r = assertTransportSafe(gas.call('adminExport', {}, 'csv'), 'export').data;
  assert.equal(r.count, 1);
  const csv = Buffer.from(r.base64, 'base64').toString('utf8');
  assert.ok(csv.startsWith('﻿"Registration Timestamp","Registration ID"'));
  assert.ok(!csv.includes('Photo Drive File ID'), 'internal file IDs excluded');
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'), 'formula neutralised in CSV');
  assert.ok(csv.includes('રમેશ કાંતિલાલ પટેલ'));
  const file = gas.drive.files.get(r.fileId);
  assert.equal(file.parent.name, 'Exports');
  const x = gas.call('adminExport', { country: 'IN' }, 'xlsx').data;
  assert.match(x.name, /\.xlsx$/);
  assert.equal(gas.drive.files.get(x.fileId).parent.name, 'Exports');
});

test('individual report creates a Google Doc + PDF in Generated_Reports', () => {
  const gas = freshPortal();
  const a = submit(gas, payload());
  gas.as(OWNER);
  const r = gas.call('adminGenerateReport', a.registrationId, { title: 'એલ્યુમની પ્રોફાઇલ', fields: { fullName: 'પૂરું નામ', bogus: 'x' }, options: { 'occupation.DOCTOR': 'ડૉક્ટર' }, groups: { personal: 'વ્યક્તિગત' } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(gas.drive.files.get(r.data.docId).parent.name, 'Generated_Reports');
  assert.equal(gas.drive.files.get(r.data.pdfId).parent.name, 'Generated_Reports');
  const doc = gas.app.docs[gas.app.docs.length - 1];
  const flat = JSON.stringify(doc._body._tables);
  assert.ok(flat.includes('પૂરું નામ') && flat.includes('ડૉક્ટર'));
  assert.equal(gas.call('adminGenerateReport', 'ALM-2028-999999', {}).code, 'NOT_FOUND');
});

test('delete requires typed confirmation and removes row, photo, summary', () => {
  const gas = freshPortal();
  const a = submit(gas, payload({ photo: { mimeType: 'image/jpeg', data: JPEG.toString('base64') }, consentPhoto: true }));
  const fid = masterRows(gas)[0][col(gas, 'photoFileId')];
  gas.as(OWNER);
  assert.equal(gas.call('adminDeleteRecord', a.registrationId, 'ALM-2028-000002').code, 'CONFIRM_MISMATCH');
  assert.equal(gas.call('adminDeleteRecord', a.registrationId, a.registrationId).ok, true);
  assert.equal(masterRows(gas).length, 0);
  assert.equal(gas.drive.files.get(fid).isTrashed(), true);
  assert.equal(gas.sheet('Countries_Summary').getRange(2, 3).getValue(), 0);
  gas.as(''); gas.resetRequestState();
  assert.equal(gas.call('getPublicStats').total, 0);
});

test('activity log, rebuild summaries and tools for admins', () => {
  const gas = freshPortal();
  submit(gas, payload());
  gas.as(OWNER);
  const act = assertTransportSafe(gas.call('adminGetActivity', 50), 'activity').data;
  assert.ok(act.length >= 2);
  assert.ok(act.some((a) => a.action === 'REGISTER'));
  // corrupt summary then rebuild
  gas.sheet('Countries_Summary').getRange(2, 3).setValue(99);
  assert.equal(gas.call('adminRebuildSummaries').data.records, 1);
  assert.equal(gas.sheet('Countries_Summary').getRange(2, 3).getValue(), 1);
  const tools = gas.call('adminGetTools').data;
  assert.match(tools.spreadsheetUrl, /docs.google.com\/spreadsheets/);
  assert.equal(tools.admins[0].email, OWNER);
});

test('daily maintenance trigger backs up and prunes old copies', () => {
  const gas = freshPortal();
  submit(gas, payload());
  setSetting(gas, 'BACKUP_RETENTION', '3');
  const trig = gas.app.triggers[0];
  for (let i = 0; i < 5; i++) { gas.resetRequestState(); gas.call('dailyMaintenance', { triggerUid: trig.getUniqueId() }); }
  const backups = [...gas.drive.files.values()].filter((f) => f.parent && f.parent.name === 'Backups');
  assert.equal(backups.filter((f) => !f.isTrashed()).length, 3);
  assert.equal(backups.filter((f) => f.isTrashed()).length, 2);
});

test('addAdmin shares the folder privately and grants access', () => {
  const gas = freshPortal();
  gas.as(OWNER);
  gas.call('addAdmin', 'Principal@School.org', 'Principal', 'ADMIN');
  const root = gas.drive.folders.get(gas.app.props.get('ROOT_FOLDER_ID'));
  assert.ok(root.editors.includes('principal@school.org'));
  gas.as('principal@school.org');
  assert.equal(gas.call('adminGetContext').data.role, 'ADMIN');
  gas.as(OWNER);
  gas.call('removeAdmin', 'principal@school.org');
  assert.ok(!root.editors.includes('principal@school.org'));
  gas.as('principal@school.org');
  assert.equal(gas.call('adminGetContext').code, 'FORBIDDEN');
});

test('spreadsheet access stays efficient (batch reads, no full-sheet reads per submission)', () => {
  const gas = freshPortal();
  for (let i = 0; i < 40; i++) submit(gas, payload({ fullName: 'Bulk ' + i.toString(36) + ' Person', mobileNumber: '91' + String(10000000 + i), email: `bulk${i}@x.org` }));
  gas.app.calls.getValues = 0; gas.app.calls.setValues = 0; gas.app.calls.appendRow = 0;
  submit(gas, payload({ fullName: 'Last Person', mobileNumber: '9555555555', email: 'last@x.org' }));
  assert.ok(gas.app.calls.getValues <= 8, 'getValues calls: ' + gas.app.calls.getValues);
  assert.ok(gas.app.calls.appendRow <= 3, 'appendRow calls: ' + gas.app.calls.appendRow);
});
