# Backup, export & data retention

## Automatic daily backup
`setup()` installs a trigger that runs `dailyMaintenance` every day around 02:00 IST. It:
1. Rebuilds `Countries_Summary`, `Occupation_Summary` and `Batch_Summary` from `Alumni_Master`.
2. Copies the whole spreadsheet to `School_Centenary_2028/Backups/Backup_…_yyyy-MM-dd_HHmm`.
3. Keeps the newest `BACKUP_RETENTION` copies (default 30) and moves older copies to Drive trash.

Check it under **Apps Script → Triggers** (clock icon) and **Executions**.

## Manual backup
- In the admin dashboard, go to **Tools → Backup now** (SUPER_ADMIN), or
- run `dailyMaintenance` from the editor, or
- in the spreadsheet, choose **File → Make a copy** or **File → Download → Microsoft Excel**.

Keep an offline copy at milestones, for example monthly and after the centenary event. To do this, download the latest backup as `.xlsx` and store it on the school's encrypted drive.

## Restore
1. Open the backup copy in `Backups/` and check the data.
2. **Either** copy the rows back into `Alumni_Master`, **or** point the portal at the backup: in **Project Settings → Script Properties**, set `SPREADSHEET_ID` to the backup's ID (the long code in its URL).
3. Run `setup()` once to check the sheets, then use **Tools → Rebuild summaries**.
4. The ID counter (`REG_SEQ` property) is never lowered automatically. If you restore to an older state, delete `REG_SEQ` and it will be recalculated from the highest existing ID.

## Exports
In **Records**, apply any search or filter, then click **CSV export** or **Excel export**.
- The file downloads immediately and is also saved in `Exports/`.
- CSV includes a UTF-8 BOM, so Excel shows Gujarati and Hindi correctly.
- Cells that start with `= + - @` get a leading `'` to prevent spreadsheet formula injection.
- Internal Drive file IDs are not exported.

Exports contain personal data. Share them only with authorised people, and delete old files in `Exports/` when you no longer need them.

## Data retention & deletion requests
- The privacy policy says data is kept for the centenary plus `DATA_RETENTION_YEARS` years (Settings).
- If an alumnus asks for deletion, a SUPER_ADMIN opens the profile and clicks **Delete permanently**, then types the Registration ID. The row and the photo are removed, the summaries are updated, and the action is logged. Old backups still contain the record until they age out of the retention window. Delete a specific backup manually if the request requires it.
- Corrections can be made by any ADMIN through **Edit**. Each edit records `Last Updated By`, and the changed field names are logged.
