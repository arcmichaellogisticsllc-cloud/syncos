# Sign-in methods and automatic prime-package delivery

These controls are implemented for engineering acceptance. Real providers and destinations remain disabled until their configuration and receipt behavior are verified. This guide does not authorize an operational pilot.

## Email sign-in

1. Open **Sign in**. If email sign-in is enabled, choose **Email me a sign-in link**.
2. Enter your email. If you belong to multiple workspaces, enter the workspace code supplied by your administrator.
3. Choose **Send sign-in link**. The same message appears for known and unknown accounts; it does not promise delivery.
4. Open the email within 15 minutes. Select **Continue to my workspace** only if you requested it.
5. The link signs you into the workspace permitted by your existing roles. It cannot reset your password or grant another role.
6. An expired, already used, or revoked link requires a new request. Password recovery invalidates outstanding sign-in links. Closing the link page before continuing may require reopening the original email.

## Organization sign-in

1. On **Sign in**, expand **Sign in with your organization** when enabled.
2. Enter your workspace code and select **Find my sign-in provider**.
3. Choose the configured provider. Complete its sign-in in the same browser tab.
4. SyncOS checks the returned identity against an explicitly approved account link and current workspace membership.
5. A missing link or changed permission returns a sign-in error; contact your administrator. Your provider's role names do not grant SyncOS permissions.
6. Use the existing **Sign out** control to end the local session. This does not promise to end your organization's separate provider session; its logout policy is verified during provider activation.

Administrators with workspace-wide user-management permission can open **Sign-in Settings**. Select/create a connection, enter the operator-supplied endpoint and credential-reference fields, and save it. Never paste secrets. Search for an active member, enter the provider's verified subject identifier, then **Link identity**. Revoke a link to remove access; existing sessions are invalidated. A provider issuer change requires a new connection. The existing password sign-in remains available for approved recovery use.

## Automatic invoice-package delivery

1. Open the accepted-production financial workspace and select the invoice in **Invoice packages and customer responses**.
2. Review the approved agreement, prime package requirements, and original evidence. Attach required reviewed PDFs.
3. Choose **Prepare complete invoice package**. Download and review the resulting revision if needed.
4. An authorized contract reviewer opens **Approve delivery destination**, enters the prime-approved endpoint, recipient, operator-supplied credential reference and approval source, verifies the receipt contract, and saves it. Only server-approved hosts are accepted.
5. A user with invoice-delivery permission opens **Queue complete package**, selects its current revision and approved destination, and queues delivery.
6. Refresh delivery status. When automatic sending is disabled, jobs remain queued. Queuing does not establish delivery.
7. **Delivered** means the receiver returned a matching package checksum, receipt identifier and delivery time and SyncOS recorded the event. Customer acceptance remains pending.
8. **Review** means transmission or local recording was uncertain. Do not queue another copy. Check the prime's actual receipt first. If delivered, record the verified delivery in package history, then choose **Resolve uncertain delivery → Verified delivery already recorded**. If the prime confirms no delivery, choose that outcome and provide its proof reference; a new request can then be queued.
9. **Failed** means pre-delivery validation failed. Fix the underlying permission/package/destination problem, cancel the unsent job with a reason, then prepare a new request.
10. Use **Revoke destination** when a destination is retired. Queued requests fail their next destination check; already transmitted packages cannot be recalled.
11. Record a customer rejection separately. Correct the package and prepare a new revision when its contents change. Queue the resubmission only after rejection is recorded.
12. Record **customer invoice acceptance** only with actual acceptance proof. A transport receipt never supplies this approval or changes invoice-acceptance payment terms by itself.

The generic HTTPS receiver contract is documented in `docs/deployment/identity-and-prime-delivery.md`. Compatibility with any prime's real portal, email, or SFTP channel is a separate integration check.

## Review workspace access

1. Open **Administration → Workspace Access** with workspace-wide user-management permission.
2. Search for a member by name or email. Use **Next members** to review additional matches.
3. Open the member and review current role grants and their scopes.
4. To suspend or restore workspace membership, select **Disabled** or **Active**, record the reviewed reason, and choose **Save membership status**. Invited or archived members use their onboarding/recovery process.
5. With role-management permission, choose an approved internal role bundle, select **Grant** or **Revoke**, record the reason, and save.
6. SyncOS blocks self-changes, grants exceeding the administrator's own powers, and removal of the last active administrator. Existing sessions for the affected member are invalidated.
7. Manage partner and field roles through workforce onboarding; this page cannot turn those scoped roles into tenant-wide grants. Creating a new account remains part of the existing onboarding process.

## Global search

1. Open **Search → Global search**.
2. Enter a name or reference and select **Search records**.
3. Review the record type and status before opening a result. Only record types you may read appear.
4. Use **Next search results** to continue beyond the first 50 results; use **Back to first results** to restart the same search.
5. Select **Include archived records** and search again when reviewing preserved history.
6. If the request fails, your search remains available to retry. A search result does not grant additional actions.

## Review an account onboarding profile

1. Open **Intelligence → Account onboarding** and choose the account's stage and lane.
2. Select **Review Onboarding** on an account with a saved profile. **Open Account** opens the broader organization record. For an account without a profile, authorized users can select **Start Onboarding**, choose the prime/customer or contractor/vendor lane, and review before saving.
3. Review the owner, contact, required/missing-document summaries, programs and next action. These summaries do not replace original documents or an approved compliance policy.
4. If your role can update onboarding, choose the tracking stage and enter the next action, its due date, and tracking notes. Read-only users see no editing form.
5. Select **Review changes**. Read the confirmation: changing tracking does not approve contracts, authorize work, accept production or release money.
6. Select **Keep editing** to return without saving, or **Confirm tracking update** to save an audited change.
7. A service failure keeps your entries. If another reviewer changed the profile, save is rejected; retain your intended changes separately, reload the page, compare the latest profile and re-enter only the changes still appropriate.

There is no automatic progression from an onboarding label to field mobilization or financial authorization. Those controls remain in their respective workflows.


## Account program originals and document readiness

1. Open **Intelligence → Account onboarding**, then open a saved profile.
2. Under **Program document requirements**, enter the approved program name and choose **Add program**. Choose it from **Review program**.
3. Use **Original file → Preserve original** for the governing requirements and submitted evidence. Supported originals are PDF, JPEG, PNG and WebP up to 10 MiB. Identical-file retries reuse the preserved original.
4. Download and inspect the originals. Uploading alone does not establish readability, approval or completeness.
5. Expand **Record a governing policy revision**. Select the governing original, its effective dates, required documents (one per line), and the approval reason. Confirm the requirements against the original, then choose **Record policy revision**. Dates use the UTC calendar.
6. For each requirement, choose its evidence original, decision, expiry (if applicable) and review reason. Approval requires confirming readability and compliance with that requirement. Choose **Record document review**.
7. Resolve missing, rejected, submitted or expired requirements. Configured programs prevent advancing onboarding to approved, market-assigned or mobilized while their current requirements are unsatisfied.
8. Use **Policy and review history** to inspect earlier decisions. A new governing policy requires fresh review; it does not overwrite the previous policy or its evidence.
9. If another reviewer changed the record, reload and inspect the latest decision before resubmitting. Failed requests preserve the entered fields.
10. Read-only users can inspect requirements, history and originals, but cannot create programs, upload, approve policies or record reviews. Access requires tenant-wide onboarding permission.

Document readiness never creates a contract, work assignment, customer acceptance, invoice or payment. Older summary fields remain historical tracking information and are not converted into approved program policies automatically. Original files are stored with the database and must be included in coordinated database backups and restore verification.
