# Disable Public Inquiry Runbook

## Symptoms

- Abuse spike.
- API instability on public inquiry route.
- Edge protection failure.

## Checks

- WAF/rate-limit metrics.
- API route 4xx/5xx.
- Recent inquiry count by source/IP hash.

## Safe Actions

- Block `POST /partner-invitations/public-inquiries` at edge.
- Temporarily remove/disable website endpoint meta tag in website deploy if needed.
- Leave other website forms untouched.

## Escalation

Release engineer, website operator, partner operations.

## Data Safety

Do not delete existing inquiry records during incident response.

## Verification

Public inquiry no longer reaches API; existing internal inquiry review still works.
