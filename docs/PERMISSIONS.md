# Google account permissions & admin security

## Who owns what

| Resource | Owner | Shared with | Public? |
|---|---|---|---|
| Apps Script project | School account | Optional co-developers | No |
| `School_Centenary_2028` folder and spreadsheet | School account | Admins (editor), added by `addAdmin()` | **Never** |
| Alumni photographs | School account | Admins, through the folder | **Never**; only Drive file IDs are stored |
| Public web app | Runs as the school account | Anyone (no sign-in) | Yes, form and aggregate data only |
| Admin web app | Runs as each signed-in admin | Anyone with a Google account can open it; only `Admin_Users` get data | No data without authorisation |

## OAuth scopes (`appsscript.json`)

| Scope | Used for |
|---|---|
| `spreadsheets` | Reading and writing the alumni database |
| `drive` | Folder tree, photos, backups, exports, sharing with admins |
| `documents` | Individual alumni reports as Google Docs |
| `script.send_mail` | Optional bilingual confirmation email (`MailApp`) |
| `script.scriptapp` | Installing the daily maintenance trigger |
| `script.external_request` | Converting an export to `.xlsx` with Google's own export endpoint |
| `userinfo.email` | Identifying the signed-in admin |

## Admin roles

Roles are stored in the `Admin_Users` sheet. Only the owner can edit that sheet, because it is protected.

| Role | Can |
|---|---|
| `VIEWER` | View dashboard, search, view profiles, print, view activity |
| `ADMIN` | Everything above, plus edit records, approve or hide public profiles, export CSV/Excel, generate reports, rebuild summaries |
| `SUPER_ADMIN` | Everything above, plus delete records (with typed confirmation), run backups, see database and folder links |

The project owner, recorded by `setup()`, is always `SUPER_ADMIN`. Set `Active` to `FALSE` (or run `removeAdmin`) to revoke access immediately.

## How the protection works

- Every admin function (`adminSearch`, `adminUpdateProfile`, …) calls `getAdminUser_()` first. It reads the caller's verified Google email from `Session.getActiveUser()` and checks it against `Admin_Users`. Denied attempts are written to `Registration_Logs` as `ADMIN_DENIED`.
- Anonymous visitors of the public deployment have no identity (an empty email), so every admin call returns `NOT_SIGNED_IN`. Knowing the admin URL is not enough.
- `setup`, `addAdmin`, `removeAdmin` and `dailyMaintenance` run only for the owner in the editor, or for a genuine installed trigger. A browser cannot call them.
- Helper functions end in `_`, which Apps Script makes uncallable from `google.script.run`.
- The spreadsheet ID, folder IDs and owner email live in **Script Properties** on the server. They never appear in page source (an automated test checks this).
- Consent fields cannot be changed by admins. Only the alumnus gives consent.
