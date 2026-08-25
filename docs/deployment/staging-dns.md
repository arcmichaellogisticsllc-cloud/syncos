# Staging DNS and TLS

Do not change DNS until the hosting targets exist.

## Records

| Hostname | Type | Target | Proxy | TLS |
|---|---|---|---|---|
| `staging-app.synccommsystems.com` | CNAME or A | provider web service target | provider dependent | HTTPS required |
| `staging-api.synccommsystems.com` | CNAME or A | provider API service target | provider dependent | HTTPS required |

Do not invent target values before services are provisioned.

## TLS Requirements

- HTTPS only for app and API.
- Automatic TLS is acceptable when provided by the hosting platform.
- HTTP should redirect to HTTPS.
- Browser login must not occur over HTTP.
- CORS must allow `https://staging-app.synccommsystems.com` only for staging app access.

## Verification

```sh
dig staging-app.synccommsystems.com
dig staging-api.synccommsystems.com
curl -I https://staging-app.synccommsystems.com/login
curl -I https://staging-api.synccommsystems.com/health
```

Expected result: valid TLS, no mixed content, app login loads, API health responds.
