# Deployment guide — step by step

Use the school's own Google account (for example `alumni.centenary@gmail.com` or a Google Workspace account). That account **owns** the spreadsheet, the Drive folder and the script, so do not use a personal account that may be closed later.

## 1. Create the Apps Script project

**Option A: copy and paste (no tools needed)**

1. Open <https://script.google.com> → **New project**. Rename it `Centenary 2028 Alumni Portal`.
2. Delete the default `Code.gs` content.
3. For each `.gs` file in `src/`: click **+ → Script**, use the same name without `.gs` (e.g. `Configuration`, `RegistrationService`, `AdminService`), and paste the content.
   Apps Script does not allow a script file and an HTML file with the same name, which is why the script files are `RegistrationService` / `AdminService` while the pages are `Registration` / `Admin`.
4. For each `.html` file: click **+ → HTML**, use the same name without `.html` (e.g. `Index`, `CSS`, `JavaScript`, `Translations`, `Registration`, `Admin`), and paste the content. **The names must match exactly**, because the pages include each other by name.
5. **Project Settings (⚙) → Show "appsscript.json" manifest file in editor** → open `appsscript.json` and replace it with `src/appsscript.json`.
6. In Project Settings, check that the time zone is `(GMT+05:30) India Standard Time`.

**Option B: clasp (command line)**

```bash
npm install -g @google/clasp
clasp login
clasp create --type standalone --title "Centenary 2028 Alumni Portal" --rootDir src
# or, for an existing project: cp .clasp.json.example .clasp.json and paste the scriptId
clasp push
```

## 2. Run `setup()` once

1. In the editor, select the `Code.gs` file, choose **`setup`** in the function dropdown, and click **Run**.
2. Google asks for authorisation: **Review permissions → choose the school account → Advanced → Go to project (unsafe) → Allow**. The "unsafe" warning appears because this is your own unverified script. See [PERMISSIONS.md](PERMISSIONS.md) for what each scope is used for.
3. The execution log prints the spreadsheet and folder URLs.

`setup()` creates:

```
My Drive/School_Centenary_2028/
  ├─ Centenary_2028_Alumni_Database   (spreadsheet)
  ├─ Alumni_Photos/
  ├─ Generated_Reports/
  ├─ Exports/
  └─ Backups/
```

It also creates these sheets: `Alumni_Master`, `Registration_Logs`, `Countries_Summary`, `Occupation_Summary`, `Batch_Summary`, `Admin_Users`, `Settings`. It registers you as `SUPER_ADMIN`, protects the configuration sheets, and installs a daily 02:00 IST maintenance trigger for the backup and the summary rebuild.

Running `setup()` again is safe: it repairs missing pieces and never deletes data.

## 3. Configure the school details

Open the spreadsheet → **Settings** sheet and edit the **Value** column:

| Key | Example |
|---|---|
| `SCHOOL_NAME_GU` / `SCHOOL_NAME_HI` / `SCHOOL_NAME_EN` | The school name in each language |
| `CONTACT_ADDRESS`, `CONTACT_PHONE`, `CONTACT_EMAIL`, `CONTACT_WEBSITE` | Shown in the Contact section |
| `REGISTRATION_OPEN` | `TRUE` / `FALSE` |
| `SEND_CONFIRMATION_EMAIL` | `TRUE` / `FALSE` |
| `MAX_PHOTO_MB` | `1`–`5` |
| `PUBLIC_STATS_ENABLED`, `DIRECTORY_ENABLED` | Show or hide those homepage sections |
| `BACKUP_RETENTION` | Number of daily backups to keep |
| `DATA_RETENTION_YEARS` | Quoted in the privacy policy |

Settings are cached for 5 minutes, so changes appear within 5 minutes.

To change other homepage text (history, timeline, invitation), edit the matching keys in `Translations.html`, in **both** `gu` and `hi`.

## 4. Add administrators

In the editor, run (edit the arguments first):

```javascript
function addMyAdmins() {
  addAdmin('principal@gmail.com', 'Principal', 'SUPER_ADMIN');
  addAdmin('teacher.coordinator@gmail.com', 'Alumni Coordinator', 'ADMIN');
  addAdmin('trustee@gmail.com', 'Trustee', 'VIEWER');
}
```

Paste this into any `.gs` file, run `addMyAdmins` once, then delete it. Each admin gets private edit access to the portal folder; Google emails them a sharing notice. To revoke access, run `removeAdmin('email')`.

## 5. Deploy the web apps

You create **two deployments of the same project**. Each deployment has its own access settings.

### 5a. Public registration site

**Deploy → New deployment → ⚙ Web app**

| Field | Value |
|---|---|
| Description | `Public v1` |
| Execute as | **Me** (the school account) |
| Who has access | **Anyone** |

Copy the URL (it ends in `/exec`) and share it with alumni by WhatsApp, email and so on. Visitors do **not** need a Google account. The script runs as the school account, so visitors never get access to the spreadsheet.

### 5b. Admin dashboard

**Deploy → New deployment → ⚙ Web app**

| Field | Value |
|---|---|
| Description | `Admin v1` |
| Execute as | **User accessing the web app** |
| Who has access | **Anyone with Google account** |

The admin URL is this deployment's URL followed by `?page=admin`, for example `https://script.google.com/macros/s/AKfy…/exec?page=admin`.

Why a second deployment: when the public deployment runs as the owner, Google does not reveal a visiting Gmail user's identity to the script, so it cannot tell who the admin is. On the admin deployment each admin signs in with Google, and every admin function checks that email against `Admin_Users`. Anyone else sees "Access denied" and receives no data, even if they have the URL. As the owner you can also open `?page=admin` on the public URL.

Admins open the admin URL once and approve the permission prompt, the same way as in step 2.

### 5c. Updating later

After you change code: **Deploy → Manage deployments → ✏ (edit) → Version: New version → Deploy**. Do this for **both** deployments. The URLs stay the same.

## 6. Go-live checklist

- [ ] `setup()` ran without errors and the folder and spreadsheet exist
- [ ] Settings sheet has the real school name and contact details
- [ ] Public URL opens in a private or incognito window without signing in
- [ ] A test registration shows a `ALM-2028-…` ID and the confirmation email arrives
- [ ] The admin URL shows "Access denied" for a non-admin Gmail account
- [ ] The admin URL works for every admin account
- [ ] Test registrations are deleted (Records → profile → Delete) before launch
- [ ] The spreadsheet's **Share** dialog lists only the school account and the admins (never "Anyone with the link")
