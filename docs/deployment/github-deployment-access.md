# GitHub Deployment Access

## Source Repositories

SyncOS app:

```text
https://github.com/arcmichaellogisticsllc-cloud/syncos.git
```

Public website:

```text
https://github.com/arcmichaellogisticsllc-cloud/Jackson-Telcom.git
```

The repositories are separate and must remain independently deployable.

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
