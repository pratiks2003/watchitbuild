# Org X-Ray

Connect a Salesforce org, and watch an AI crew dig through it in 3D to work out how the business really runs. Then ask the crew anything, in plain words or technical detail.

Built entirely on Salesforce: Experience Cloud (LWR), Lightning Web Components, Apex and the Einstein Models API.

**Live site:** https://orgfarm-bd59095f65-dev-ed.develop.my.site.com/watchitbuild/

> Status: phase 0 (setup and technical checks) is done. See [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) for the plan and progress.

## How it works

```
Visitor's browser (public LWR site)                 watchitbuild org
  metadata index + agent tools + 3D scene  ──JSON──▶  guest Apex ──▶ Einstein Models API
  (the visitor's org data stays here)      ◀──JSON──  checks every model response
```

- The visitor's org data never leaves their browser. Our org stores no scans.
- The model only proposes the next step. Apex checks every response against a fixed contract, and the tools are plain code that only reads.

## Project layout

| Path                                        | What                                               |
| ------------------------------------------- | -------------------------------------------------- |
| `force-app/main/default/lwc`                | Lightning Web Components                           |
| `force-app/main/default/classes`            | Apex (guest controllers, model client, validation) |
| `force-app/main/default/digitalExperiences` | The public LWR site                                |
| `scripts/smoke/guest-smoke.mjs`             | Logged-out smoke test of the live site             |
| `.github/workflows/ci.yml`                  | CI: lint, tests, validate on PR, deploy on `main`  |
| `docs/BUILD_PLAN.md`                        | Plan, phases and decisions                         |

## Local commands

```bash
npm install
npm run lint && npm run prettier:verify && npm test
sf project deploy start --source-dir force-app --test-level RunLocalTests --target-org watchitbuild
sf community publish --name watchitbuild --target-org watchitbuild
node scripts/smoke/guest-smoke.mjs https://orgfarm-bd59095f65-dev-ed.develop.my.site.com/watchitbuild/
```

## CI setup

CI needs one repository secret, `SFDX_AUTH_URL`, for the `watchitbuild` org:

```bash
sf org display --target-org watchitbuild --verbose --json | jq -r .result.sfdxAuthUrl | gh secret set SFDX_AUTH_URL --repo pratiks2003/watchitbuild
```

The workflow refuses to run against any other org.
