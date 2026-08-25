# Hostinger VPS Security Checklist

## Network

- Publicly allow only SSH, HTTP, and HTTPS.
- Keep Postgres bound to localhost/private addresses only.
- Keep Redis bound to localhost/private addresses only.
- Keep app internal ports blocked publicly.
- Confirm UFW before changing any SSH policy.

Observed during audit:

- UFW active.
- Public allow: `22`, `80`, `443`.
- Public deny: `5432`, `6379`, `3137`, `3138`.

## SSH

Required target posture:

- Key-based access verified for at least one non-root admin user.
- `PermitRootLogin prohibit-password` or `no`.
- `PasswordAuthentication no`.
- Dedicated deploy/service user.
- Never commit private keys.

Observed during audit:

- Root SSH works with key.
- `PermitRootLogin yes`.
- `PasswordAuthentication yes`.
- No usable deploy-login account was confirmed.
- Public key fingerprint for local Hostinger key: `SHA256:34cruS0kxVhAPcdtwyShmOSiadvihd1kSFgp0xaQQJM`.

Do not disable root/password SSH until a second key-based admin session is proven.

## OS Hardening

- Keep unattended security updates enabled.
- Keep fail2ban enabled.
- Keep NTP active.
- Add swap sized for builds and memory spikes.
- Configure log rotation for systemd, Nginx, Postgres, Redis, app logs, and npm logs.
- Avoid disruptive `apt upgrade` or reboot during business activity without a maintenance window.

Observed during audit:

- fail2ban enabled and active.
- unattended-upgrades enabled and active.
- systemd-timesyncd active.
- no swap configured.

## App Secrets

Never log or print:

- passwords
- JWTs
- invite tokens
- database URLs with passwords
- email API keys
- storage credentials
- private SSH keys
- sensitive uploaded documents
- tax or bank data

Use `/etc/syncos/staging/*.env` and `/etc/syncos/production/*.env` or an equivalent secret manager. Env files should be `600 root:root`.

## Auth

Staging must use:

- HTTPS only;
- strong `AUTH_JWT_SECRET`;
- no default/test signing secret;
- staging-only CORS origins;
- login rate limiting;
- staging invite URLs pointing to `https://staging-app.synccommsystems.com`;
- email recipient allowlist.

Known limitation: the current browser session model uses browser-accessible bearer storage rather than HttpOnly secure cookies. This is acceptable for controlled staging, but should be hardened before broad external production rollout.

## Payments

Set and verify:

```text
LIVE_AUTOMATED_PARTNER_PAYMENTS=false
```

No live ACH, bank instruction, production payment provider, or automated Partner payout should be configured for staging.

## Storage

Private application files must live outside public web roots. Nginx must not serve restricted file directories directly.

For local VPS staging storage, use:

```text
/opt/syncos/staging/shared/storage
```

The API mediates all access and enforces tenant/user authorization.
