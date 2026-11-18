'use strict';
/* Translation dictionary completeness: both languages, every key used. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createGas } = require('./gas-mock');

const SRC = path.join(__dirname, '..', 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const tr = read('Translations.html').replace(/^\s*<script>|<\/script>\s*$/g, '');
const win = {}; vm.runInNewContext(tr, { window: win });
const { gu, hi } = win.I18N;
const gas = createGas();
const boot = gas.run('JSON.parse(JSON.stringify({ options: OPTIONS, fields: MASTER_SCHEMA.map(c => c.key) }))');

test('Gujarati and Hindi dictionaries have identical keys and no empty values', () => {
  const g = Object.keys(gu).sort(), h = Object.keys(hi).sort();
  assert.deepEqual(g.filter((k) => !hi[k]), [], 'missing in Hindi');
  assert.deepEqual(h.filter((k) => !gu[k]), [], 'missing in Gujarati');
  for (const [lang, d] of [['gu', gu], ['hi', hi]]) for (const k of Object.keys(d)) assert.ok(String(d[k]).trim(), `${lang}.${k} empty`);
  // placeholders must match between languages
  for (const k of g) {
    const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
    assert.equal(ph(gu[k]), ph(hi[k]), 'placeholder mismatch in ' + k);
  }
});

test('every static data-i18n key used in the HTML exists', () => {
  const html = ['Index.html', 'Registration.html', 'Admin.html', 'JavaScript.html'].map(read).join('\n');
  const keys = new Set();
  for (const m of html.matchAll(/data-i18n(?:-placeholder|-aria|-title)?="([^"]+)"/g)) keys.add(m[1]);
  for (const m of html.matchAll(/\bt\('([a-zA-Z0-9_.]+)'\s*[,)]/g)) keys.add(m[1]);
  for (const m of html.matchAll(/'data-i18n':\s*'([a-zA-Z0-9_.]+)'\s*[,}]/g)) keys.add(m[1]);
  const missing = [...keys].filter((k) => !(k in gu));
  assert.deepEqual(missing, []);
  assert.ok(keys.size > 150, 'found ' + keys.size + ' keys');
});

test('dynamic keys: fields, options, steps, error codes', () => {
  const need = [];
  const formFields = ['fullName', 'gender', 'dob', 'fatherName', 'photo', 'admissionYear', 'leavingYear', 'lastStandard', 'division', 'lcNumber',
    'favouriteTeacher', 'mobile', 'whatsapp', 'email', 'altPhone', 'countryCode', 'state', 'city', 'postalCode', 'address', 'occupation',
    'occupationOther', 'organization', 'designation', 'professionalField', 'website', 'achievements', 'awards', 'socialContributions',
    'schoolMemory', 'messageForSchool', 'teachersRemembered', 'attendCentenary', 'attendReunion', 'volunteer', 'supportDevelopment',
    'joinAssociation', 'consentStore', 'consentContact', 'consentDirectory', 'consentPrivacy', 'consentPhoto'];
  formFields.forEach((f) => need.push('f.' + f));
  boot.fields.filter((k) => k !== 'photoFileId').forEach((f) => need.push('f.' + f));
  boot.options.GENDER.forEach((o) => need.push('opt.gender.' + o));
  boot.options.STANDARDS.forEach((o) => need.push('opt.std.' + o));
  boot.options.OCCUPATION.forEach((o) => need.push('opt.occ.' + o));
  boot.options.PARTICIPATION.forEach((o) => need.push('opt.part.' + o));
  boot.options.MODERATION.forEach((o) => need.push('opt.mod.' + o));
  ['personal', 'school', 'contact', 'location', 'profession', 'achievements', 'participation', 'consent'].forEach((s) => need.push('step.' + s, 'step.' + s + '.title', 'step.' + s + '.hint'));
  need.push('step.review');
  // every validation code the server can return
  const codes = new Set([...read('Validation.gs').matchAll(/(?:errors\[\w+\]|errors\.\w+)\s*=\s*'(\w+)'/g)].map((m) => m[1]));
  for (const m of read('Validation.gs').matchAll(/error:\s*'(\w+)'/g)) codes.add(m[1]);
  codes.forEach((c) => need.push('err.' + c));
  // every appError_ code the admin UI can receive
  const gsAll = fs.readdirSync(SRC).filter((f) => f.endsWith('.gs')).map(read).join('\n');
  const appCodes = new Set([...gsAll.matchAll(/appError_\('(\w+)'/g)].map((m) => m[1]));
  ['FORBIDDEN', 'NOT_SIGNED_IN', 'SERVER', 'NETWORK', 'OFFLINE'].forEach((c) => appCodes.add(c));
  appCodes.forEach((c) => need.push('adm.err.' + c));
  ['SUPER_ADMIN', 'ADMIN', 'VIEWER'].forEach((r) => need.push('adm.role.' + r));
  const missing = need.filter((k) => !(k in gu));
  assert.deepEqual(missing, []);
});

test('mandated bilingual confirmation messages are exact', () => {
  assert.equal(gu['success.message'], 'તમારી માહિતી સફળતાપૂર્વક નોંધાઈ ગઈ છે. શાળાના 100 વર્ષના ઐતિહાસિક ઉત્સવ સાથે જોડાવા બદલ આપનો આભાર.');
  assert.equal(hi['success.message'], 'आपकी जानकारी सफलतापूर्वक दर्ज हो गई है। विद्यालय के 100 वर्षों के ऐतिहासिक उत्सव से जुड़ने के लिए आपका धन्यवाद।');
});

test('no hard-coded Latin UI sentences inside rendering code', () => {
  // text: '...' literals in el() calls must come from t(); allow numbers/symbols only.
  const js = ['Index.html', 'Registration.html', 'Admin.html', 'JavaScript.html'].map(read).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const bad = [...js.matchAll(/text:\s*'([^']*[A-Za-z]{3,}[^']*)'/g)].map((m) => m[1]);
  assert.deepEqual(bad, []);
});
