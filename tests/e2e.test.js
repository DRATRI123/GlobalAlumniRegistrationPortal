'use strict';
/**
 * End-to-end browser tests (Playwright + Chromium).
 * The real pages rendered by doGet() run in Chromium, and google.script.run is
 * bridged to the real backend code executing in the GAS mock – so these cover
 * the complete submission path: UI → validation → Sheets → Drive → response.
 *
 *   SCREENSHOTS=1 node --test tests/e2e.test.js   (also writes docs/screenshots)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { freshPortal, assertTransportSafe, OWNER } = require('./helpers');

const BASE = 'http://portal.test/';
const SHOTS = process.env.SCREENSHOTS ? path.join(__dirname, '..', 'docs', 'screenshots') : null;
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

const BRIDGE = `
  window.__marker = Math.random();
  (function () {
    function make(ok, fail) {
      return new Proxy({}, { get: function (_, name) {
        if (name === 'withSuccessHandler') return function (h) { return make(h, fail); };
        if (name === 'withFailureHandler') return function (h) { return make(ok, h); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          window.__gas(String(name), JSON.stringify(args)).then(function (raw) {
            var o = JSON.parse(raw);
            if (o.__error) { if (fail) fail(new Error(o.__error)); } else if (ok) ok(o.value);
          });
        };
      } });
    }
    window.google = { script: { run: make(null, null) } };
  })();`;

let browser;
test.before(async () => { browser = await chromium.launch(); if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true }); });
test.after(async () => { if (browser) await browser.close(); });

/** Opens a page wired to a GAS instance. */
async function openPortal(gas, opts) {
  opts = opts || {};
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 900 }, deviceScaleFactor: SHOTS ? 2 : 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); }); // fonts are blocked offline
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (SHOTS && /fonts\.(googleapis|gstatic)\.com$/.test(url.host)) return route.continue(); // real fonts for screenshots
    if (url.host !== 'portal.test') return route.abort();
    gas.resetRequestState();
    const html = gas.call('doGet', { parameter: Object.fromEntries(url.searchParams) }).getContent();
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  });
  await page.exposeFunction('__gas', async (fn, argsJson) => {
    await new Promise((r) => setTimeout(r, opts.latency || 30));
    try {
      if (/_$/.test(fn)) throw new Error('Script function not found: ' + fn); // private functions are not callable
      gas.resetRequestState();
      const v = gas.call(fn, ...JSON.parse(argsJson));
      assertTransportSafe(v, fn);
      return JSON.stringify({ value: v === undefined ? null : v });
    } catch (e) { return JSON.stringify({ __error: e.message }); }
  });
  await page.addInitScript(BRIDGE);
  page.errors = errors;
  return page;
}
const text = (page, sel) => page.locator(sel).first().innerText();
const shot = async (page, name, full) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: !!full }); };

async function fillRegistration(page, o) {
  o = Object.assign({ name: 'મીના રાજેશ શાહ', mobile: '9898989898', email: 'meena.shah@example.com', photo: true }, o);
  // Step 1
  await page.fill('#f-fullName', o.name);
  await page.click('label.chip:has(input[name="gender"][value="FEMALE"])');
  await page.fill('#f-dob', '1980-08-15');
  if (o.photo) {
    await page.setInputFiles('#f-photo', { name: 'me.png', mimeType: 'image/png', buffer: PNG_1PX });
    await page.waitForSelector('#f-photo-consentWrap:not([hidden])');
    await page.check('#f-photo-consent');
  }
  await page.click('#btnNext');
  // Step 2
  await page.selectOption('#f-admissionYear', '1986');
  await page.selectOption('#f-leavingYear', '1996');
  await page.selectOption('#f-lastStandard', '12');
  await page.fill('#f-division', 'B');
  await page.click('#btnNext');
  // Step 3
  await page.fill('#f-mobile-num', o.mobile);
  await page.check('#f-whatsapp-same');
  await page.fill('#f-email', o.email);
  await page.click('#btnNext');
  // Step 4
  await page.selectOption('#f-countryCode', 'GB');
  await page.fill('#f-state', 'England');
  await page.fill('#f-city', 'Leicester');
  await page.fill('#f-postalCode', 'LE1 5WW');
  await page.click('#btnNext');
  // Step 5
  await page.selectOption('#f-occupation', 'TEACHER');
  await page.fill('#f-organization', 'Leicester College');
  await page.fill('#f-designation', 'Lecturer');
  await page.fill('#f-professionalField', 'Education');
  await page.click('#btnNext');
  // Step 6 (optional)
  await page.fill('#f-schoolMemory', 'Annual day drama in 1994.');
  await page.click('#btnNext');
  // Step 7
  for (const k of ['attendCentenary', 'attendReunion', 'volunteer', 'supportDevelopment', 'joinAssociation']) {
    await page.click(`label.chip:has(input[name="${k}"][value="YES"])`);
  }
  await page.click('#btnNext');
  // Step 8
  for (const k of ['consentStore', 'consentContact', 'consentDirectory', 'consentPrivacy']) await page.check('#f-' + k);
  await page.click('#btnNext');
}

/* ===================================================================== */

test('homepage renders in Gujarati and switches to Hindi without reload', async () => {
  const gas = freshPortal();
  const page = await openPortal(gas);
  await page.goto(BASE);
  assert.equal(await page.getAttribute('html', 'lang'), 'gu');
  assert.equal(await text(page, '.hero__title'), 'શતાબ્દી મહોત્સવ');
  assert.equal(await text(page, '.nav__cta'), 'નોંધણી કરો');
  assert.match(await text(page, '.hero__years'), /1928 – 2028/);
  assert.equal(await page.getAttribute('[data-lang="gu"]', 'aria-pressed'), 'true');
  await page.waitForSelector('#statsEmpty:not([hidden])');
  assert.match(await text(page, '#statsEmpty'), /પ્રથમ નોંધણી/);
  await shot(page, '01-home-gujarati');
  const marker = await page.evaluate(() => window.__marker);

  await page.click('[data-lang="hi"]');
  assert.equal(await page.getAttribute('html', 'lang'), 'hi');
  assert.equal(await text(page, '.nav__cta'), 'पंजीकरण करें');
  assert.equal(await text(page, '#about .section__title'), '100 वर्षों की शैक्षणिक उत्कृष्टता');
  assert.equal(await page.evaluate(() => window.__marker), marker, 'no page reload');
  assert.match(await page.title(), /शताब्दी/);
  await shot(page, '02-home-hindi');

  await page.reload();
  assert.equal(await page.getAttribute('html', 'lang'), 'hi', 'language preference remembered');
  await page.click('.footer [data-open="privacyModal"]');
  assert.match(await text(page, '#privacyBody'), /आधार, पैन/);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('full registration flow: step validation, review, submit, bilingual confirmation', async () => {
  const gas = freshPortal();
  const page = await openPortal(gas, { latency: 250 });
  await page.goto(BASE);
  await page.click('.hero [data-action="register"]');
  await page.waitForSelector('#view-register:not([hidden])');
  assert.equal(await text(page, '#stepCount'), 'પગલું 1 / 9');

  // Required-field validation on step 1
  await page.click('#btnNext');
  assert.equal(await text(page, '[data-error-for="fullName"]'), 'આ વિગત ફરજિયાત છે.');
  assert.equal(await text(page, '[data-error-for="gender"]'), 'આ વિગત ફરજિયાત છે.');
  await shot(page, '03-form-validation');
  // Error text follows the language switch
  await page.click('[data-lang="hi"]');
  assert.equal(await text(page, '[data-error-for="fullName"]'), 'यह विवरण अनिवार्य है।');
  assert.equal(await text(page, '#stepCount'), 'चरण 1 / 9');
  await page.click('[data-lang="gu"]');

  // Invalid phone / email on step 3 are caught client side
  await page.fill('#f-fullName', 'મીના રાજેશ શાહ');
  await page.click('label.chip:has(input[name="gender"][value="FEMALE"])');
  await page.click('#btnNext');
  await page.selectOption('#f-admissionYear', '1996');
  await page.selectOption('#f-leavingYear', '1986');
  await page.selectOption('#f-lastStandard', '12');
  await page.click('#btnNext');
  assert.equal(await text(page, '[data-error-for="leavingYear"]'), 'શાળા છોડ્યાનું વર્ષ પ્રવેશ વર્ષ પછીનું હોવું જોઈએ.');
  await page.reload(); // draft is restored from localStorage
  await page.click('.hero [data-action="register"]');
  await page.waitForSelector('#draftRestored:not([hidden])');
  assert.equal(await page.inputValue('#f-fullName'), 'મીના રાજેશ શાહ');
  await page.click('#draftDiscard');
  assert.equal(await page.inputValue('#f-fullName'), '');

  await fillRegistration(page);
  // Review
  await page.waitForSelector('#reviewStep:not([hidden])');
  const review = await text(page, '#reviewBody');
  assert.match(review, /મીના રાજેશ શાહ/);
  assert.match(review, /\+91 9898989898/);
  assert.match(review, /શિક્ષક \/ પ્રોફેસર/);
  assert.match(review, /ફોટો જોડાયેલ છે/);
  assert.match(review, /યુનાઇટેડ કિંગડમ|United Kingdom/);
  await shot(page, '04-review', true);

  // Double click on submit must create exactly one record
  await page.dblclick('#btnSubmit');
  await page.waitForSelector('#loadingOverlay:not([hidden])');
  await page.waitForSelector('#regSuccessView:not([hidden])');
  assert.equal(await text(page, '#successMessage'), 'તમારી માહિતી સફળતાપૂર્વક નોંધાઈ ગઈ છે. શાળાના 100 વર્ષના ઐતિહાસિક ઉત્સવ સાથે જોડાવા બદલ આપનો આભાર.');
  assert.equal(await text(page, '#successId'), 'ALM-2028-000001');
  assert.equal(await page.isVisible('#successEmail'), true);
  await shot(page, '05-success-gujarati');
  await page.click('[data-lang="hi"]');
  assert.equal(await text(page, '#successMessage'), 'आपकी जानकारी सफलतापूर्वक दर्ज हो गई है। विद्यालय के 100 वर्षों के ऐतिहासिक उत्सव से जुड़ने के लिए आपका धन्यवाद।');
  await shot(page, '06-success-hindi');

  // Database checks
  const sh = gas.sheet('Alumni_Master');
  assert.equal(sh.getLastRow(), 2, 'exactly one record');
  const rec = gas.run('readAllRecords_()')[0];
  assert.equal(rec.fullName, 'મીના રાજેશ શાહ');
  assert.equal(rec.mobile, '+919898989898');
  assert.equal(rec.whatsapp, '+919898989898');
  assert.equal(rec.countryCode, 'GB');
  assert.equal(rec.postalCode, 'LE1 5WW');
  assert.equal(rec.language, 'gu');
  assert.ok(rec.photoFileId, 'photo stored');
  assert.equal(gas.drive.files.get(rec.photoFileId).getBlob().getContentType(), 'image/jpeg');
  assert.equal(gas.app.mail.length, 1);
  assert.equal(await page.evaluate(() => localStorage.getItem('alumni2028_draft_v1')), null, 'draft cleared');

  // Home statistics now reflect the real registration
  await page.click('#regSuccessView [data-action="home"]');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#statTotal').textContent === '1');
  assert.equal(await text(page, '#statAbroad'), '1');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('duplicate registration is rejected in the UI with a translated message', async () => {
  const gas = freshPortal();
  const page = await openPortal(gas);
  await page.goto(BASE);
  await page.click('.hero [data-action="register"]');
  await fillRegistration(page, { photo: false });
  await page.click('#btnSubmit');
  await page.waitForSelector('#regSuccessView:not([hidden])');
  await page.click('#btnAnother');
  await fillRegistration(page, { photo: false, email: 'other@example.com' });
  await page.click('#btnSubmit');
  await page.waitForSelector('#formError:not([hidden])');
  assert.match(await text(page, '#formError'), /પહેલેથી થઈ ચૂકી છે/);
  assert.equal(gas.sheet('Alumni_Master').getLastRow(), 2);
  await page.click('[data-lang="hi"]');
  assert.match(await text(page, '#formError'), /पहले से पंजीकृत/);
  await page.context().close();
});

test('admin dashboard is denied to anonymous visitors and works for authorised admins', async () => {
  const gas = freshPortal();
  gas.call('submitRegistration', require('./helpers').payload());
  gas.call('submitRegistration', require('./helpers').payload({ fullName: 'Asha Shah', mobileNumber: '9000000005', whatsappNumber: '9000000005', email: 'asha@x.org', countryCode: 'US', state: 'NJ', city: 'Edison' }));

  gas.as('');
  let page = await openPortal(gas);
  await page.goto(BASE + '?page=admin');
  await page.waitForSelector('#gateDenied:not([hidden])');
  assert.match(await text(page, '#gateDeniedText'), /અધિકૃત Google એકાઉન્ટ/);
  assert.equal(await page.isVisible('#admApp'), false);
  assert.equal(await page.evaluate(() => document.querySelector('#rows').children.length), 0);
  await page.context().close();

  gas.as('stranger@gmail.com');
  page = await openPortal(gas);
  await page.goto(BASE + '?page=admin');
  await page.waitForSelector('#gateDenied:not([hidden])');
  assert.match(await text(page, '#gateDeniedText'), /અધિકૃત નથી/);
  await page.context().close();

  gas.as(OWNER);
  page = await openPortal(gas);
  await page.goto(BASE + '?page=admin');
  await page.waitForSelector('#admApp:not([hidden])');
  await page.waitForFunction(() => document.querySelectorAll('#kpis .kpi').length === 8);
  assert.equal((await text(page, '#kpis .kpi')).split('\n')[0], '2');
  assert.equal(await text(page, '#admEmail'), OWNER);
  await shot(page, '07-admin-overview', true);

  await page.click('[data-tab="records"]');
  await page.waitForSelector('#rows tr');
  assert.equal(await page.locator('#rows tr').count(), 2);
  await page.selectOption('#qField', 'name');
  await page.fill('#qText', 'asha');
  await page.click('#filterForm button[type="submit"]');
  await page.waitForFunction(() => document.querySelectorAll('#rows tr').length === 1);
  await page.fill('#qText', '');
  await page.selectOption('#qCountry', 'IN');
  await page.click('#filterForm button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#rows tr td') && document.querySelector('#rows tr td').textContent === 'ALM-2028-000001');
  await shot(page, '08-admin-records');

  await page.click('#rows tr');
  await page.waitForSelector('#profileModal:not([hidden])');
  assert.match(await text(page, '#pfTitle'), /ALM-2028-000001/);
  assert.match(await text(page, '#pfBody'), /\+919876543210/);
  await shot(page, '09-admin-profile');
  await page.click('#pfBody .profile-actions .btn--primary'); // edit
  await page.waitForSelector('#editForm');
  await page.fill('#e-city', 'Vadodara');
  await page.fill('#e-email', 'not valid');
  await page.click('#editForm button[type="submit"]');
  assert.equal(await text(page, '#editForm [data-error-for="email"]'), 'કૃપા કરીને માન્ય ઈમેલ સરનામું લખો.');
  await page.fill('#e-email', 'ramesh@example.com');
  await page.click('#editForm button[type="submit"]');
  await page.waitForSelector('#editForm', { state: 'detached' });
  const rec = gas.run('readAllRecords_()').find((r) => r.registrationId === 'ALM-2028-000001');
  assert.equal(rec.city, 'Vadodara');
  assert.equal(rec.email, 'ramesh@example.com');
  assert.equal(rec.updatedBy, OWNER);

  await page.click('[data-close="profileModal"]');
  await page.click('[data-tab="activity"]');
  await page.waitForFunction(() => [...document.querySelectorAll('#actRows td')].some((td) => td.textContent === 'EDIT'));
  await page.click('[data-lang="hi"]');
  assert.equal(await text(page, '[data-tab="records"]'), 'पूर्व छात्र रिकॉर्ड');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('mobile layout: no horizontal scrolling at 375px', async () => {
  const gas = freshPortal();
  gas.as(OWNER);
  const page = await openPortal(gas, { viewport: { width: 375, height: 760 } });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.goto(BASE);
  assert.equal(await overflow(), 0, 'home');
  await shot(page, '10-mobile-home');
  await page.click('.nav__toggle');
  assert.equal(await page.isVisible('#navLinks a[data-scroll="about"]'), true, 'mobile menu opens');
  await page.click('.nav__toggle');
  await page.click('.hero [data-action="register"]');
  await page.fill('#f-fullName', 'Test Person');
  await page.click('label.chip:has(input[name="gender"][value="MALE"])');
  await page.click('#btnNext');
  await page.click('#btnNext');
  assert.equal(await overflow(), 0, 'registration');
  await page.goto(BASE + '?page=admin');
  await page.waitForSelector('#admApp:not([hidden])');
  assert.equal(await overflow(), 0, 'admin');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
