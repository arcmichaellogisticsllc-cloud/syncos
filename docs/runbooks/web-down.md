# Web Down Runbook

## Symptoms

- `https://app.synccommsystems.com/login` fails.
- Critical routes return 5xx or hydration errors.

## Checks

- Web service deploy status.
- `SYNCOS_API_BASE_URL` configured.
- API health.
- Browser console for asset/chunk errors.

## Safe Actions

- Roll back web artifact.
- Restart web service.
- Keep API/worker unchanged if healthy.

## Escalation

Release engineer and platform operator.

## Data Safety

Web rollback does not require database rollback.

## Verification

Login, Partner invite, Partner portal, Foreman Today, and Command Center load.
