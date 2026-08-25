# Squarespace DNS For SyncOS

## Boundary

Squarespace remains authoritative DNS for `synccommsystems.com` unless explicitly changed later. Do not transfer the domain or change nameservers for this staging work.

Do not modify records serving:

- `synccommsystems.com`
- `www.synccommsystems.com`
- mail routing
- SPF/DKIM/DMARC
- provider verification records

## Staging Records To Add After VPS Is Ready

Assuming the Hostinger VPS public IP remains `2.25.82.68`:

| Type | Host | Value | TTL |
|---|---|---|---|
| A | `staging-app` | `2.25.82.68` | 300 during setup, then 3600 |
| A | `staging-api` | `2.25.82.68` | 300 during setup, then 3600 |

Use CNAME only if Hostinger provides a stable hostname target. For direct VPS IP routing, A records are simpler.

## DNS Cutover Sequence

1. Confirm VPS services are healthy locally.
2. Confirm Nginx/Caddy has staging server blocks.
3. Confirm firewall exposes only SSH/80/443.
4. Add `staging-app` and `staging-api` records in Squarespace.
5. Wait for DNS resolution.
6. Issue TLS certificates.
7. Verify HTTPS.
8. Verify API CORS from staging app.
9. Keep staging unadvertised.

## Verification

```bash
dig staging-app.synccommsystems.com
dig staging-api.synccommsystems.com
curl -I https://staging-app.synccommsystems.com/login
curl -fsS https://staging-api.synccommsystems.com/health
```

Expected result: both names resolve to the VPS, TLS is valid, web login loads, API health responds, and no root/public website DNS changed.

## Production Later

The public website CTA should eventually remain:

```text
https://app.synccommsystems.com/login
```

Do not point public visitors to staging.
