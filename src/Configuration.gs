/**
 * Configuration.gs
 * ---------------------------------------------------------------------------
 * Central, non-secret configuration for the Centenary 2028 Alumni Portal.
 *
 * Nothing in this file is a secret. Spreadsheet / folder IDs are created by
 * setup() and stored in Script Properties (server side only) — they are never
 * written here and never sent to public visitors.
 */

const APP = Object.freeze({
  NAME: 'School Centenary 2028 – Global Alumni Portal',
  VERSION: '1.0.0',
  ID_PREFIX: 'ALM-2028-',
  ID_PAD: 6,
  TIMEZONE: 'Asia/Kolkata',
  FOUNDING_YEAR: 1928,
  CENTENARY_YEAR: 2028,
  PRIVACY_VERSION: '2026-11-v1',
  LOCK_TIMEOUT_MS: 20000,
  MAX_PHOTO_MB_DEFAULT: 2,
  ALLOWED_PHOTO_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
  CACHE_TTL_PUBLIC: 600,      // seconds – public statistics / directory
  CACHE_TTL_ADMIN: 120,       // seconds – admin dashboard statistics
  SUBMISSION_TOKEN_TTL: 21600, // seconds – idempotency window (6h, CacheService max)
  BACKUP_RETENTION_DEFAULT: 30,
  ADMIN_PAGE_SIZE: 25,
  DIRECTORY_PAGE_SIZE: 24,
  MAX_EXPORT_ROWS: 50000
});

/** Script Property keys (values live only in PropertiesService). */
const PROP = Object.freeze({
  SPREADSHEET_ID: 'SPREADSHEET_ID',
  ROOT_FOLDER_ID: 'ROOT_FOLDER_ID',
  PHOTOS_FOLDER_ID: 'PHOTOS_FOLDER_ID',
  REPORTS_FOLDER_ID: 'REPORTS_FOLDER_ID',
  EXPORTS_FOLDER_ID: 'EXPORTS_FOLDER_ID',
  BACKUPS_FOLDER_ID: 'BACKUPS_FOLDER_ID',
  REG_SEQ: 'REG_SEQ',
  OWNER_EMAIL: 'OWNER_EMAIL'
});

const FOLDERS = Object.freeze({
  ROOT: 'School_Centenary_2028',
  PHOTOS: 'Alumni_Photos',
  REPORTS: 'Generated_Reports',
  EXPORTS: 'Exports',
  BACKUPS: 'Backups'
});

const SPREADSHEET_NAME = 'Centenary_2028_Alumni_Database';

const SHEETS = Object.freeze({
  MASTER: 'Alumni_Master',
  LOGS: 'Registration_Logs',
  COUNTRIES: 'Countries_Summary',
  OCCUPATIONS: 'Occupation_Summary',
  BATCHES: 'Batch_Summary',
  ADMINS: 'Admin_Users',
  SETTINGS: 'Settings'
});

/**
 * Alumni_Master column schema. Order = column order in the sheet.
 * type: 'date' (stored as Date), 'number', 'bool' (YES/NO), default text.
 * group is used by reports / admin profile view.
 */
const MASTER_SCHEMA = Object.freeze([
  { key: 'timestamp', header: 'Registration Timestamp', type: 'date', group: 'meta' },
  { key: 'registrationId', header: 'Registration ID', group: 'meta' },
  { key: 'status', header: 'Record Status', group: 'meta' },
  { key: 'fullName', header: 'Full Name', group: 'personal' },
  { key: 'gender', header: 'Gender', group: 'personal' },
  { key: 'dob', header: 'Date of Birth', group: 'personal' },
  { key: 'fatherName', header: "Father's Name", group: 'personal' },
  { key: 'photoFileId', header: 'Photo Drive File ID', group: 'personal' },
  { key: 'admissionYear', header: 'Admission Year', type: 'number', group: 'school' },
  { key: 'leavingYear', header: 'Leaving / Passing Year', type: 'number', group: 'school' },
  { key: 'lastStandard', header: 'Last Studied Standard', group: 'school' },
  { key: 'division', header: 'Division / Section', group: 'school' },
  { key: 'lcNumber', header: 'School Leaving Certificate No.', group: 'school' },
  { key: 'favouriteTeacher', header: 'Favourite Teacher', group: 'school' },
  { key: 'mobile', header: 'Mobile Number', group: 'contact' },
  { key: 'whatsapp', header: 'WhatsApp Number', group: 'contact' },
  { key: 'email', header: 'Email Address', group: 'contact' },
  { key: 'altPhone', header: 'Alternative Contact Number', group: 'contact' },
  { key: 'countryCode', header: 'Country Code (ISO)', group: 'location' },
  { key: 'country', header: 'Country', group: 'location' },
  { key: 'state', header: 'State / Province', group: 'location' },
  { key: 'city', header: 'City', group: 'location' },
  { key: 'postalCode', header: 'Postal / ZIP Code', group: 'location' },
  { key: 'address', header: 'Current Address', group: 'location' },
  { key: 'occupation', header: 'Occupation Code', group: 'profession' },
  { key: 'occupationOther', header: 'Occupation (Other)', group: 'profession' },
  { key: 'organization', header: 'Company / Organization', group: 'profession' },
  { key: 'designation', header: 'Designation', group: 'profession' },
  { key: 'professionalField', header: 'Professional Field', group: 'profession' },
  { key: 'website', header: 'Business / Professional Website', group: 'profession' },
  { key: 'achievements', header: 'Major Professional Achievements', group: 'achievements' },
  { key: 'awards', header: 'Awards and Recognitions', group: 'achievements' },
  { key: 'socialContributions', header: 'Social Contributions', group: 'achievements' },
  { key: 'schoolMemory', header: 'Favourite School Memory', group: 'achievements' },
  { key: 'messageForSchool', header: 'Message for School', group: 'achievements' },
  { key: 'teachersRemembered', header: 'Former Teachers Remembered', group: 'achievements' },
  { key: 'attendCentenary', header: 'Attend Centenary Celebration', group: 'participation' },
  { key: 'attendReunion', header: 'Alumni Reunion', group: 'participation' },
  { key: 'volunteer', header: 'Volunteer', group: 'participation' },
  { key: 'supportDevelopment', header: 'Support School Development', group: 'participation' },
  { key: 'joinAssociation', header: 'Join Alumni Association', group: 'participation' },
  { key: 'consentStore', header: 'Consent: Store Information', type: 'bool', group: 'consent' },
  { key: 'consentContact', header: 'Consent: Contact by School', type: 'bool', group: 'consent' },
  { key: 'consentDirectory', header: 'Consent: Public Directory', type: 'bool', group: 'consent' },
  { key: 'consentPhoto', header: 'Consent: Store Photograph', type: 'bool', group: 'consent' },
  { key: 'consentPrivacy', header: 'Privacy Policy Accepted', type: 'bool', group: 'consent' },
  { key: 'consentTimestamp', header: 'Consent Timestamp', type: 'date', group: 'consent' },
  { key: 'privacyVersion', header: 'Privacy Policy Version', group: 'consent' },
  { key: 'language', header: 'Preferred Language', group: 'meta' },
  { key: 'moderation', header: 'Public Display Moderation', group: 'meta' },
  { key: 'possibleDuplicateOf', header: 'Possible Duplicate Of', group: 'meta' },
  { key: 'adminNotes', header: 'Admin Notes', group: 'meta' },
  { key: 'lastUpdated', header: 'Last Updated', type: 'date', group: 'meta' },
  { key: 'updatedBy', header: 'Last Updated By', group: 'meta' }
]);

const LOG_HEADERS = ['Timestamp', 'Action', 'Registration ID', 'Actor', 'Status', 'Details', 'Submission Token'];
const COUNTRY_SUMMARY_HEADERS = ['Country Code', 'Country', 'Alumni Count', 'Last Updated'];
const OCCUPATION_SUMMARY_HEADERS = ['Occupation Code', 'Occupation', 'Alumni Count', 'Last Updated'];
const BATCH_SUMMARY_HEADERS = ['Leaving / Passing Year', 'Alumni Count', 'Last Updated'];
const ADMIN_HEADERS = ['Email', 'Name', 'Role', 'Active', 'Added On', 'Notes'];
const SETTINGS_HEADERS = ['Key', 'Value', 'Description'];

/** Settings sheet defaults: [key, value, description]. */
const DEFAULT_SETTINGS = Object.freeze([
  ['SCHOOL_NAME_GU', 'શ્રી [શાળાનું નામ] વિદ્યાલય', 'School name in Gujarati (shown on the website)'],
  ['SCHOOL_NAME_HI', 'श्री [विद्यालय का नाम] विद्यालय', 'School name in Hindi (shown on the website)'],
  ['SCHOOL_NAME_EN', 'Shri [School Name] Vidyalaya', 'School name in English (reports, emails, exports)'],
  ['CONTACT_ADDRESS', '[School address, City, Gujarat – PIN]', 'Postal address shown in Contact section'],
  ['CONTACT_PHONE', '+91 00000 00000', 'Contact phone shown publicly'],
  ['CONTACT_EMAIL', 'alumni@example.org', 'Contact email shown publicly'],
  ['CONTACT_WEBSITE', '', 'Optional school website URL'],
  ['CENTENARY_EVENT_DATE', '2028', 'Celebration date text shown on the website'],
  ['REGISTRATION_OPEN', 'TRUE', 'TRUE / FALSE – accept new registrations'],
  ['SEND_CONFIRMATION_EMAIL', 'TRUE', 'TRUE / FALSE – email the Registration ID to the alumnus'],
  ['MAX_PHOTO_MB', '2', 'Maximum profile photograph size in MB (1–5)'],
  ['PUBLIC_STATS_ENABLED', 'TRUE', 'TRUE / FALSE – show aggregate statistics on the homepage'],
  ['DIRECTORY_ENABLED', 'TRUE', 'TRUE / FALSE – show consented & approved alumni in the public directory'],
  ['BACKUP_RETENTION', '30', 'How many daily spreadsheet backups to keep in Backups/'],
  ['DATA_RETENTION_YEARS', '10', 'Years data is retained after the centenary unless deletion is requested']
]);

/** Only these settings are ever sent to the browser. */
const PUBLIC_SETTING_KEYS = Object.freeze([
  'SCHOOL_NAME_GU', 'SCHOOL_NAME_HI', 'SCHOOL_NAME_EN', 'CONTACT_ADDRESS', 'CONTACT_PHONE',
  'CONTACT_EMAIL', 'CONTACT_WEBSITE', 'CENTENARY_EVENT_DATE', 'REGISTRATION_OPEN',
  'MAX_PHOTO_MB', 'PUBLIC_STATS_ENABLED', 'DIRECTORY_ENABLED', 'DATA_RETENTION_YEARS'
]);

const ROLES = Object.freeze({ SUPER_ADMIN: 3, ADMIN: 2, VIEWER: 1 });

const OPTIONS = Object.freeze({
  GENDER: ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT'],
  STANDARDS: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
  OCCUPATION: ['GOVT', 'PRIVATE', 'BUSINESS', 'DOCTOR', 'ENGINEER', 'TEACHER', 'FARMER', 'STUDENT', 'RETIRED', 'OTHER'],
  PARTICIPATION: ['YES', 'NO', 'MAYBE'],
  MODERATION: ['PENDING', 'APPROVED', 'HIDDEN', 'NOT_CONSENTED']
});

/** Occupations for which organisation / designation / field are optional. */
const OCCUPATIONS_WITHOUT_EMPLOYER = Object.freeze(['FARMER', 'STUDENT', 'RETIRED', 'OTHER']);

const OCCUPATION_LABELS_EN = Object.freeze({
  GOVT: 'Government Employee', PRIVATE: 'Private Employee', BUSINESS: 'Business Owner',
  DOCTOR: 'Doctor', ENGINEER: 'Engineer', TEACHER: 'Teacher / Professor', FARMER: 'Farmer',
  STUDENT: 'Student', RETIRED: 'Retired', OTHER: 'Other'
});

const PARTICIPATION_KEYS = Object.freeze(['attendCentenary', 'attendReunion', 'volunteer', 'supportDevelopment', 'joinAssociation']);

/**
 * Countries: [ISO 3166-1 alpha-2, international calling code, English name].
 * Display names in Gujarati / Hindi are produced in the browser with
 * Intl.DisplayNames; English names are stored in the sheet for readability.
 */
const COUNTRIES = Object.freeze([
  ['IN', '91', 'India'], ['AF', '93', 'Afghanistan'], ['AL', '355', 'Albania'], ['DZ', '213', 'Algeria'],
  ['AS', '1', 'American Samoa'], ['AD', '376', 'Andorra'], ['AO', '244', 'Angola'], ['AI', '1', 'Anguilla'],
  ['AG', '1', 'Antigua and Barbuda'], ['AR', '54', 'Argentina'], ['AM', '374', 'Armenia'], ['AW', '297', 'Aruba'],
  ['AU', '61', 'Australia'], ['AT', '43', 'Austria'], ['AZ', '994', 'Azerbaijan'], ['BS', '1', 'Bahamas'],
  ['BH', '973', 'Bahrain'], ['BD', '880', 'Bangladesh'], ['BB', '1', 'Barbados'], ['BY', '375', 'Belarus'],
  ['BE', '32', 'Belgium'], ['BZ', '501', 'Belize'], ['BJ', '229', 'Benin'], ['BM', '1', 'Bermuda'],
  ['BT', '975', 'Bhutan'], ['BO', '591', 'Bolivia'], ['BA', '387', 'Bosnia and Herzegovina'], ['BW', '267', 'Botswana'],
  ['BR', '55', 'Brazil'], ['BN', '673', 'Brunei'], ['BG', '359', 'Bulgaria'], ['BF', '226', 'Burkina Faso'],
  ['BI', '257', 'Burundi'], ['KH', '855', 'Cambodia'], ['CM', '237', 'Cameroon'], ['CA', '1', 'Canada'],
  ['CV', '238', 'Cape Verde'], ['KY', '1', 'Cayman Islands'], ['CF', '236', 'Central African Republic'], ['TD', '235', 'Chad'],
  ['CL', '56', 'Chile'], ['CN', '86', 'China'], ['CO', '57', 'Colombia'], ['KM', '269', 'Comoros'],
  ['CG', '242', 'Congo'], ['CD', '243', 'Congo (DRC)'], ['CR', '506', 'Costa Rica'], ['CI', '225', "Côte d'Ivoire"],
  ['HR', '385', 'Croatia'], ['CU', '53', 'Cuba'], ['CW', '599', 'Curaçao'], ['CY', '357', 'Cyprus'],
  ['CZ', '420', 'Czechia'], ['DK', '45', 'Denmark'], ['DJ', '253', 'Djibouti'], ['DM', '1', 'Dominica'],
  ['DO', '1', 'Dominican Republic'], ['EC', '593', 'Ecuador'], ['EG', '20', 'Egypt'], ['SV', '503', 'El Salvador'],
  ['GQ', '240', 'Equatorial Guinea'], ['ER', '291', 'Eritrea'], ['EE', '372', 'Estonia'], ['SZ', '268', 'Eswatini'],
  ['ET', '251', 'Ethiopia'], ['FO', '298', 'Faroe Islands'], ['FJ', '679', 'Fiji'], ['FI', '358', 'Finland'],
  ['FR', '33', 'France'], ['GF', '594', 'French Guiana'], ['PF', '689', 'French Polynesia'], ['GA', '241', 'Gabon'],
  ['GM', '220', 'Gambia'], ['GE', '995', 'Georgia'], ['DE', '49', 'Germany'], ['GH', '233', 'Ghana'],
  ['GI', '350', 'Gibraltar'], ['GR', '30', 'Greece'], ['GL', '299', 'Greenland'], ['GD', '1', 'Grenada'],
  ['GP', '590', 'Guadeloupe'], ['GU', '1', 'Guam'], ['GT', '502', 'Guatemala'], ['GG', '44', 'Guernsey'],
  ['GN', '224', 'Guinea'], ['GW', '245', 'Guinea-Bissau'], ['GY', '592', 'Guyana'], ['HT', '509', 'Haiti'],
  ['HN', '504', 'Honduras'], ['HK', '852', 'Hong Kong'], ['HU', '36', 'Hungary'], ['IS', '354', 'Iceland'],
  ['ID', '62', 'Indonesia'], ['IR', '98', 'Iran'], ['IQ', '964', 'Iraq'], ['IE', '353', 'Ireland'],
  ['IM', '44', 'Isle of Man'], ['IL', '972', 'Israel'], ['IT', '39', 'Italy'], ['JM', '1', 'Jamaica'],
  ['JP', '81', 'Japan'], ['JE', '44', 'Jersey'], ['JO', '962', 'Jordan'], ['KZ', '7', 'Kazakhstan'],
  ['KE', '254', 'Kenya'], ['KI', '686', 'Kiribati'], ['XK', '383', 'Kosovo'], ['KW', '965', 'Kuwait'],
  ['KG', '996', 'Kyrgyzstan'], ['LA', '856', 'Laos'], ['LV', '371', 'Latvia'], ['LB', '961', 'Lebanon'],
  ['LS', '266', 'Lesotho'], ['LR', '231', 'Liberia'], ['LY', '218', 'Libya'], ['LI', '423', 'Liechtenstein'],
  ['LT', '370', 'Lithuania'], ['LU', '352', 'Luxembourg'], ['MO', '853', 'Macao'], ['MG', '261', 'Madagascar'],
  ['MW', '265', 'Malawi'], ['MY', '60', 'Malaysia'], ['MV', '960', 'Maldives'], ['ML', '223', 'Mali'],
  ['MT', '356', 'Malta'], ['MH', '692', 'Marshall Islands'], ['MQ', '596', 'Martinique'], ['MR', '222', 'Mauritania'],
  ['MU', '230', 'Mauritius'], ['MX', '52', 'Mexico'], ['FM', '691', 'Micronesia'], ['MD', '373', 'Moldova'],
  ['MC', '377', 'Monaco'], ['MN', '976', 'Mongolia'], ['ME', '382', 'Montenegro'], ['MA', '212', 'Morocco'],
  ['MZ', '258', 'Mozambique'], ['MM', '95', 'Myanmar'], ['NA', '264', 'Namibia'], ['NR', '674', 'Nauru'],
  ['NP', '977', 'Nepal'], ['NL', '31', 'Netherlands'], ['NC', '687', 'New Caledonia'], ['NZ', '64', 'New Zealand'],
  ['NI', '505', 'Nicaragua'], ['NE', '227', 'Niger'], ['NG', '234', 'Nigeria'], ['KP', '850', 'North Korea'],
  ['MK', '389', 'North Macedonia'], ['NO', '47', 'Norway'], ['OM', '968', 'Oman'], ['PK', '92', 'Pakistan'],
  ['PW', '680', 'Palau'], ['PS', '970', 'Palestine'], ['PA', '507', 'Panama'], ['PG', '675', 'Papua New Guinea'],
  ['PY', '595', 'Paraguay'], ['PE', '51', 'Peru'], ['PH', '63', 'Philippines'], ['PL', '48', 'Poland'],
  ['PT', '351', 'Portugal'], ['PR', '1', 'Puerto Rico'], ['QA', '974', 'Qatar'], ['RE', '262', 'Réunion'],
  ['RO', '40', 'Romania'], ['RU', '7', 'Russia'], ['RW', '250', 'Rwanda'], ['KN', '1', 'Saint Kitts and Nevis'],
  ['LC', '1', 'Saint Lucia'], ['VC', '1', 'Saint Vincent and the Grenadines'], ['WS', '685', 'Samoa'], ['SM', '378', 'San Marino'],
  ['ST', '239', 'São Tomé and Príncipe'], ['SA', '966', 'Saudi Arabia'], ['SN', '221', 'Senegal'], ['RS', '381', 'Serbia'],
  ['SC', '248', 'Seychelles'], ['SL', '232', 'Sierra Leone'], ['SG', '65', 'Singapore'], ['SX', '1', 'Sint Maarten'],
  ['SK', '421', 'Slovakia'], ['SI', '386', 'Slovenia'], ['SB', '677', 'Solomon Islands'], ['SO', '252', 'Somalia'],
  ['ZA', '27', 'South Africa'], ['KR', '82', 'South Korea'], ['SS', '211', 'South Sudan'], ['ES', '34', 'Spain'],
  ['LK', '94', 'Sri Lanka'], ['SD', '249', 'Sudan'], ['SR', '597', 'Suriname'], ['SE', '46', 'Sweden'],
  ['CH', '41', 'Switzerland'], ['SY', '963', 'Syria'], ['TW', '886', 'Taiwan'], ['TJ', '992', 'Tajikistan'],
  ['TZ', '255', 'Tanzania'], ['TH', '66', 'Thailand'], ['TL', '670', 'Timor-Leste'], ['TG', '228', 'Togo'],
  ['TO', '676', 'Tonga'], ['TT', '1', 'Trinidad and Tobago'], ['TN', '216', 'Tunisia'], ['TR', '90', 'Türkiye'],
  ['TM', '993', 'Turkmenistan'], ['TC', '1', 'Turks and Caicos Islands'], ['TV', '688', 'Tuvalu'], ['UG', '256', 'Uganda'],
  ['UA', '380', 'Ukraine'], ['AE', '971', 'United Arab Emirates'], ['GB', '44', 'United Kingdom'], ['US', '1', 'United States'],
  ['UY', '598', 'Uruguay'], ['UZ', '998', 'Uzbekistan'], ['VU', '678', 'Vanuatu'], ['VA', '39', 'Vatican City'],
  ['VE', '58', 'Venezuela'], ['VN', '84', 'Vietnam'], ['VG', '1', 'British Virgin Islands'], ['VI', '1', 'U.S. Virgin Islands'],
  ['YE', '967', 'Yemen'], ['ZM', '260', 'Zambia'], ['ZW', '263', 'Zimbabwe']
]);

let __countryMap = null;
/** @return {Object<string,{dial:string,name:string}>} */
function getCountryMap_() {
  if (__countryMap) return __countryMap;
  const m = {};
  COUNTRIES.forEach(function (c) { m[c[0]] = { dial: c[1], name: c[2] }; });
  __countryMap = m;
  return m;
}

/** Column index lookup (0-based) for Alumni_Master. */
let __masterIndex = null;
function masterIndex_() {
  if (__masterIndex) return __masterIndex;
  const idx = {};
  MASTER_SCHEMA.forEach(function (c, i) { idx[c.key] = i; });
  __masterIndex = idx;
  return idx;
}

/** Data the browser needs to render forms (non-secret). */
function getClientBootstrap_() {
  return {
    version: APP.VERSION,
    foundingYear: APP.FOUNDING_YEAR,
    centenaryYear: APP.CENTENARY_YEAR,
    currentYear: Number(Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy')),
    privacyVersion: APP.PRIVACY_VERSION,
    countries: COUNTRIES.map(function (c) { return [c[0], c[1], c[2]]; }),
    options: OPTIONS,
    occupationsWithoutEmployer: OCCUPATIONS_WITHOUT_EMPLOYER,
    allowedPhotoTypes: APP.ALLOWED_PHOTO_TYPES
  };
}
