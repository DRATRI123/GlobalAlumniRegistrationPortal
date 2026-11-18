# Global School Alumni Registration Portal — Centenary 1928–2028

A bilingual (Gujarati / Hindi) alumni registration portal for a school's 100th anniversary, built **entirely on Google Apps Script**. There is no external server or database: Google Sheets is the database, Google Drive stores files, Google Docs produces reports, and the Apps Script Web App hosts it.

| | |
|---|---|
| **Public site** | Homepage with hero, about, invitation, live alumni statistics, directory, memories, contact |
| **Registration** | 8-step form + final review, progress indicator, draft autosave, photo upload with consent |
| **Database** | 7 auto-created sheets; IDs like `ALM-2028-000001` |
| **Admin** | Statistics, search/filter, profile view/edit, moderation, CSV/Excel export, Doc/PDF reports, print, activity log, backups |
| **Languages** | ગુજરાતી (default) and हिन्दी, switched without a page reload; one central dictionary |
| **Security** | Server-side validation, Google-account admin roles checked on every call, LockService ID generation, private Drive storage |

Screenshots: [`docs/screenshots/`](docs/screenshots).

## Project layout

```
src/                         ← the Apps Script project (push this folder)
  appsscript.json            manifest: scopes, V8, Asia/Kolkata
  Configuration.gs           constants, sheet schema, options, countries + dial codes
  Code.gs                    doGet routing, setup(), addAdmin(), triggers, public API
  Database.gs                Sheets access layer, summaries, settings, caching, logging
  RegistrationService.gs     submission flow, duplicates, ID generation, confirmation email
  Validation.gs              server-side validation & sanitisation
  AdminService.gs            role-checked admin API
  DriveService.gs            folder tree, photos, backups, sharing
  ReportService.gs           Google Doc/PDF reports, CSV/XLSX exports
  Index.html                 public page (homepage + includes)
  Registration.html          registration form, review and success screens
  Admin.html                 admin dashboard
  CSS.html                   design system (cream / maroon / navy / antique gold)
  JavaScript.html            shared client core: i18n engine, API wrapper, form schema & validation
  Translations.html          the central Gujarati + Hindi dictionary
tests/                       Node test suite (runs the real .gs code against a GAS emulator)
docs/                        deployment, permissions, testing, backup guides
```

## Documentation

1. [Deployment — step by step](docs/DEPLOYMENT.md)
2. [Google account permissions & admin access](docs/PERMISSIONS.md)
3. [Testing](docs/TESTING.md)
4. [Backup, export & data retention](docs/BACKUP.md)

## Quick start

1. Create a new Apps Script project at <https://script.google.com> (signed in as the school's account).
2. Copy every file from `src/` into it, or use `clasp push` (see the deployment guide).
3. Run `setup()` once from the editor and approve the permissions.
4. Edit the **Settings** sheet: school name, address, phone, email.
5. Deploy two web apps, a public one and an admin one ([details](docs/DEPLOYMENT.md#5-deploy-the-web-apps)).

## Running the tests locally

```bash
npm install          # installs Playwright (Chromium is needed for the browser tests)
npm test             # 34 backend + 5 i18n + 5 end-to-end browser tests
```
