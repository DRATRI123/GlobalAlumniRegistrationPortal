'use strict';
const crypto = require('crypto');
const { createGas } = require('./gas-mock');

const OWNER = 'owner@school.org';

/** Fresh portal: setup() run by the owner, then the session becomes anonymous. */
function freshPortal(opts) {
  const gas = createGas(Object.assign({ activeUser: OWNER, effectiveUser: OWNER }, opts || {}));
  gas.call('setup');
  gas.as('');
  gas.resetRequestState();
  return gas;
}

let seq = 0;
function payload(overrides) {
  seq++;
  return Object.assign({
    submissionToken: crypto.randomUUID(),
    language: 'gu',
    hp: '',
    fullName: 'રમેશ કાંતિલાલ પટેલ',
    gender: 'MALE',
    dob: '1975-04-12',
    fatherName: 'Kantilal Patel',
    admissionYear: '1981',
    leavingYear: '1991',
    lastStandard: '10',
    division: 'A',
    lcNumber: 'LC/1991/45',
    favouriteTeacher: 'Shri Joshi Sir',
    mobileCountry: 'IN', mobileNumber: '98765 43210',
    whatsappCountry: 'IN', whatsappNumber: '9876543210',
    email: 'Ramesh.Patel@Example.com',
    altPhoneCountry: 'US', altPhoneNumber: '',
    countryCode: 'IN', state: 'Gujarat', city: 'Ahmedabad', postalCode: '380001', address: '12, Station Road',
    occupation: 'DOCTOR', occupationOther: '', organization: 'Civil Hospital', designation: 'Surgeon',
    professionalField: 'Healthcare', website: 'example.org',
    achievements: 'Performed 1000 surgeries', awards: '', socialContributions: 'Free health camps',
    schoolMemory: 'Morning prayers under the banyan tree.', messageForSchool: 'Happy centenary!', teachersRemembered: 'Joshi Sir',
    attendCentenary: 'YES', attendReunion: 'YES', volunteer: 'MAYBE', supportDevelopment: 'YES', joinAssociation: 'NO',
    consentStore: true, consentContact: true, consentDirectory: true, consentPrivacy: true, consentPhoto: false,
    photo: null
  }, overrides || {});
}

/** Throws if a value contains Date objects (google.script.run cannot return them). */
function assertTransportSafe(v, where) {
  const walk = (x, p) => {
    if (x instanceof Date || Object.prototype.toString.call(x) === '[object Date]') throw new Error('Date object in response at ' + p + ' (' + where + ')');
    if (x && typeof x === 'object') Object.keys(x).forEach((k) => walk(x[k], p + '.' + k));
  };
  walk(v, '$');
  return v;
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

module.exports = { freshPortal, payload, assertTransportSafe, OWNER, JPEG, PNG, createGas };
