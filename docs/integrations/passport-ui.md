# Passport UI preparation

## Built

The application now has `/passport`, accessible through Finance → Passport Reconciliation for accounts with `partner_payment.confirm`. Route access uses the existing server-loaded identity; forged local permission hints do not grant entry. A matching protected GET endpoint provides pure synthetic scenarios through the reconciliation core. It makes no provider calls and does not read or mutate financial records.

The page uses the existing CommandShell, typography and navigation. It includes connection status (awaiting sandbox), last successful sync (never), disabled automatic recording/payment sending, recorded/pending/duplicate examples, a searchable exception filter, expandable reasons and next-step guidance, empty results, loading and retry states. Every record is prominently labeled as an invented example. There are no live match, resolve, connect or payment controls.

The UI/UX Pro Max search initially returned a marketing-oriented design pattern, which was not suitable for this internal workspace. The page retains the existing application design and applies the relevant status feedback, readable contrast, 44px interaction targets, keyboard focus and responsive layout guidance.

## Verification

- Three isolated Playwright tests passed: finance review/filter/details/empty states, denied identity overriding forged local grants, and recovery after a simulated service outage.
- Browser tests use mocked identity and preview responses; they are not authenticated staging or real Passport acceptance.
- Compiled API permission-guard test passed for allowed/denied permission results and verified the exact `partner_payment.confirm` requirement. A rejecting pool stub proves the preview endpoint does not access financial storage. This is not a live-database membership test.
- 35 reconciliation-core tests passed after moving the synthetic fixture into the package.
- Web type check and API build passed. Screenshots were inspected at 390px and 1440px; browser overflow checks also passed at 768px. No actual-phone claim is made.
- Production web build passed, including all 100 static pages. No staging deployment was performed.

Reproduce with a local web server on 127.0.0.1:3438 and `npm run passport:ui:test`. The API route test requires `npm run build -w @syncos/api` first, followed by `npm run passport:route:test`.

## Activation boundary

This is an application-integrated simulation screen, not a live finance workflow. Shared staging, demo data, accounts and existing manual payment recording remain unchanged. Durable reconciliation storage, authenticated live exception resolution, worker scheduling and verified Passport wire mapping remain to be integrated. The earlier preparation report's offline HTML preview remains available, but this page now supplies the in-application preview requested by the user.
