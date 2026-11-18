# Testing

## 1. Automated tests (run locally, before deploying)

```bash
npm install
npm test
```

`tests/gas-mock.js` emulates `SpreadsheetApp`, `DriveApp`, `CacheService`, `LockService`, `PropertiesService`, `Session`, `MailApp`, `DocumentApp`, `HtmlService` templates and so on, and loads the **real** `src/*.gs` files. It is strict on purpose: out-of-grid ranges throw, unescaped strings are auto-parsed the way Sheets parses them, and a `Date` in a response fails, like `google.script.run`.

| Suite | What it covers |
|---|---|
| `backend.test.js` (34) | setup and idempotency, sheet/folder creation, owner-only functions, sequential unique IDs, ID recovery, idempotent resubmission, hard and soft duplicates, server validation codes, international phones, formula injection, honeypot, closed registration, photo consent, type, signature and size, lock contention, error handling, public stats and directory privacy, admin denial for anonymous, unknown and inactive accounts, role hierarchy, dashboard stats, search, edit with re-validation, export, reports, delete, backups and pruning, efficient batch I/O |
| `i18n.test.js` (5) | Gujarati and Hindi have identical keys, every key used in the HTML exists, every server error code has a translation, the mandated confirmation sentences are exact, no hard-coded UI text |
| `e2e.test.js` (5) | Chromium drives the real pages, with `google.script.run` bridged to the real backend: Gujarati default, Hindi switch without reload, language persistence, step validation, draft restore, the full 8-step registration with photo, review, a double click producing exactly one record, the bilingual success message and ID, duplicate rejection in the UI, admin denial and admin dashboard/search/edit, no horizontal scroll at 375 px |

`npm run screenshots` also writes PNGs to `docs/screenshots/`.

## 2. Manual acceptance test on the live deployment

Do this once after deploying, then delete the test records.

### Registration
1. Open the public URL in an incognito window and confirm no sign-in is required.
2. Confirm the page is in Gujarati. Click **हिन्दी** and confirm all text changes immediately, with no reload. Reload and confirm Hindi is remembered.
3. Click **Register** and press **Next** with nothing filled in: red required-field messages appear.
4. Fill in step 1, close the tab, and reopen it: the draft-restored banner appears.
5. Complete all steps with a non-Indian country and a `+1`/`+44` phone number, and attach a photo with photo consent.
6. Check the review page, then submit. Confirm the spinner appears, then the success message and an `ALM-2028-000001` style ID appear, and the email arrives.
7. In the sheet, check the row in `Alumni_Master`, the summaries and the `Registration_Logs` entry. Check the photo is in `Alumni_Photos/` named after the ID.

### Duplicates
8. Register again with the same name and mobile number: you get the "already registered" message and no new row.
9. Register a different name with the same mobile number (sibling case): it is accepted, and the admin sees a "possible duplicate" tag.

### Admin permissions
10. Open the admin URL with a Gmail account that is **not** in `Admin_Users`: you see "Access denied".
11. Open it as a `VIEWER`: you can search, but Edit and Export are hidden, and the server refuses them.
12. Open it as an `ADMIN`: search by name, mobile and ID, filter by country and batch, edit a city, export CSV and Excel, generate a report (a Doc and a PDF appear in `Generated_Reports/`), print.
13. As `SUPER_ADMIN`: approve a consented profile and confirm it appears in the homepage directory. Then run **Backup now**.

### Duplicate-detection rules
- **Rejected:** the same full name (ignoring case, spaces and dots) **and** any of: the same mobile, the same email, or the same admission and leaving years.
- **Accepted but flagged:** the same mobile or email with a different name. This allows siblings who share a family number.
