# GitHub Deployment Access

## Source Repositories

SyncOS app:

```text
https://github.com/arcmichaellogisticsllc-cloud/syncos.git
```

Public website current legacy remote:

```text
https://github.com/arcmichaellogisticsllc-cloud/Jackson-Telcom.git
```

The website repository is separate and must remain independently deployable. `Jackson-Telcom` is retired as an active brand/repository identity. Create a canonical Sync Comm Systems website repository and move the existing website history there before making GitHub the long-term deployment source.

Recommended canonical website repository:

```text
https://github.com/arcmichaellogisticsllc-cloud/synccommsystems.com.git
```

## Recommended VPS Access Pattern

Use a dedicated GitHub deploy key or GitHub Actions SSH deployment key. Do not use a developer personal password or broad personal access token on the VPS.

Preferred for pull-based VPS deploy:

- create one SSH deploy key dedicated to the SyncOS repository;
- private key lives only on the VPS under restricted permissions;
- public key is added to GitHub repository deploy keys;
- read-only unless write access is explicitly required;
- deployment records exact branch and commit SHA.

Preferred for push-based CI deploy:

- GitHub Actions stores the VPS SSH private key as an Actions secret;
- Actions connects to the VPS and runs the guarded staging deploy script;
- the VPS never needs broad GitHub credentials.

## Current VPS Observation

The deployed release under `/opt/syncos/current` uses origin:

```text
https://github.com/arcmichaellogisticsllc-cloud/syncos.git
```

The working copy is a detached HEAD at:

```text
1e0694b472268190084d125262e81555ad61ce1d
```

This is not the current local release candidate.

## Website Repository Migration

Do not delete the legacy repository immediately.

Recommended operator sequence:

```bash
cd /Users/User/syncos/synccommsystems.com
git status --short
git remote -v
git remote rename origin legacy-jackson
git remote add origin https://github.com/arcmichaellogisticsllc-cloud/synccommsystems.com.git
git push -u origin feat/syncos-app-integration-rc1
git remote -v
```

After verifying the canonical repository, archive the legacy `Jackson-Telcom` repository in GitHub instead of deleting it.

## Release Identity

Each deployment should record:

- environment;
- branch;
- commit SHA;
- migration ceiling;
- deploy timestamp;
- operator or automation identity.

Suggested file on VPS:

```text
/opt/syncos/staging/shared/deployments/current.json
```

Do not include secrets.
