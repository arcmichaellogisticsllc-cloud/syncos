# Partner self-service setup update

Use a Partner Admin account for the company you maintain. The server derives the company; these forms never ask you to select or type an organization ID. Controls appear only for the corresponding granted action. A Foreman account does not receive these controls.

## Company profile
1. Open **Partner Portal → Company**.
2. Expand **Save company profile**.
3. Confirm the legal name, business address, and business, primary, compliance, and settlement contact details.
4. Select **Save company profile**. Wait for **Saved**. On an error, keep the form open, correct the information or retry; entries remain.
5. To make another change, select **Enter another update**.

## Capabilities, territories, and equipment declarations
1. In **Company**, expand **Send capability declaration**. Describe the work capabilities, crew capacity, territories, and availability.
2. For equipment, open **Vehicles & Equipment**, then **Send equipment declaration**. Describe the equipment, ownership, inspection dates, and proposed crew.
3. Submit. The declaration appears in the list with its status. Return here for Sync's response.
4. If Sync requests information, submit a new declaration identifying the earlier request and supplying the requested detail.

A declaration enters internal review. It does not create verified capacity, an equipment custody agreement, a crew assignment, mobilization approval, or authorization to start. Sync reviews declarations through Partner Network and records the canonical capacity/custody records separately.

## Compliance
1. Open **Compliance → Submit W-9**. Enter the legal name, tax classification, identifier type and **last four digits only**, signed date, and choose the signed document. Select **Submit W-9**.
2. Expand **Submit payment enrollment**. Enter the enrollment contact, optional bank display name and account last four digits, and upload supporting documents when available. Submit for review. This does not activate Passport or send payment.
3. Expand **Submit insurance policy**. Choose the policy type; enter carrier, dates, dollar limits, coverage declarations, and endorsement information. Upload the certificate and applicable endorsement. Submit.
4. Select **Enter another update** for each additional required policy type. These submissions return to Sync review; partners cannot verify themselves.

Documents accept PDF, JPEG, PNG, or WebP up to 5 MB. Worker photos accept supported image formats up to 2 MB. Full tax identifiers and bank details belong only in the appropriate private documents, never ordinary form fields.

## Workers and crews
1. Open **Workers → Add worker**. Enter first/last name, work role, and your reference; save.
2. Select the worker under **Worker to maintain**. Use **Save worker details**, **Submit worker photo**, and **Submit worker credential** as applicable. Confirm the photo attestation yourself.
3. Select **Submit worker for review**. Submission does not approve the worker.
4. Open **Crews → Add crew**. Enter the name, type, and target staffing; save.
5. Select the crew under **Crew to maintain**. Use **Add crew member** with the named worker selector. Use **Assign crew foreman** or **Assign alternate foreman** when authorized. Backend readiness and membership restrictions still apply.
6. Return to **Onboarding** to inspect remaining blockers. Complete the required records and select **Submit for Sync review** when available.

Company approval, crew readiness, project mobilization, and authorization to start remain separate gates. The final submit now sends a stable request identifier, allowing safe retry without creating a second company submission.

## Verification boundaries

These steps describe the local candidate. Automated UI tests cover save/failure/retry, visibility for read-only users, and scoped worker creation. API tests cover declaration tenant scope, duplicate retry, internal response, and unchanged compliance readiness. Real-phone acceptance and staging activation remain separate release checks.
