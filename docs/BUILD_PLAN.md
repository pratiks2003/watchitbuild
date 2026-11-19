# Org X-Ray: build plan

> Connect a Salesforce org, and watch an AI crew dig through it in 3D to work out how the business really runs. Then ask the crew anything.

Status: **draft for approval** · Org: `watchitbuild` (Developer Edition, API 68.0) · Repo: `pratiks2003/watchitbuild`

---

## 1. Who it is for

| Audience                  | What they get                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| **Developer**             | Where the logic lives (flows, triggers, approvals, integrations), where to start reading, risks    |
| **Product owner**         | The real process, where deals stall, approval load, blind spots                                    |
| **Business user**         | "What happens when I…" answers in plain words                                                      |
| **"I'm new here" switch** | Adds a cheat sheet: technical for developers, business steps for product owners and business users |

Every screen must answer "what is happening right now?" in plain English: a live caption, a phase stepper (Survey → Dig → Verify → Map), and a counter of what has been read.

---

## 2. How visitors bring an org

Three ways in, built in this order:

| Mode                | How                                                         | Needs                           | Phase                   |
| ------------------- | ----------------------------------------------------------- | ------------------------------- | ----------------------- |
| **Demo org**        | Built-in fictional company (Alder & Pine Outfitters)        | Nothing                         | 1                       |
| **Upload metadata** | Visitor runs one `sf` command we give them, uploads the zip | Salesforce CLI                  | 2                       |
| **Live connect**    | Log in to a sandbox or dev org                              | Depends on the spike in phase 0 | 4 (if the spike passes) |

**Why live connect is not first:** our Apex can only call hosts listed in Remote Site Settings or Named Credentials, and those don't accept wildcards. So Apex can't call any visitor's `*.my.salesforce.com`. The likely way round is for the browser to call the visitor's org directly with a PKCE login. That needs the visitor to add our site to their org's CORS list. I'll prove or disprove this in phase 0 with a spare personal dev org. It will never be an employer org.

**Production orgs:** live connect is blocked for production. Upload mode works for any org, because the visitor controls what they export.

---

## 3. Architecture

```
 Visitor's browser (LWR site, guest)                         watchitbuild org
 ┌──────────────────────────────────────────┐               ┌───────────────────────────────┐
 │ xrayApp (LWC, state manager)             │               │ XrayController (guest Apex)   │
 │  ├─ metadata index  (in memory/IndexedDB)│  agentStep    │  ├─ XrayLimits (cap, kill)    │
 │  ├─ agent tools  (run on the index)      │ ────────────▶ │  ├─ XrayPrompts               │
 │  ├─ agent loop   (orchestrates the crew) │ ◀──────────── │  ├─ XrayContract (validates)  │
 │  ├─ docs RAG     (vectors, cosine in JS) │  JSON only    │  └─ XrayModels ──Named Cred──▶ Einstein
 │  └─ 3D scene     (three.js, static res.) │               │                    Models API │
 └──────────────────────────────────────────┘               └───────────────────────────────┘
```

**Key decisions:**

1. **The visitor's org data never lands in our org.** The scan, its index and the findings stay in the browser. A visitor can download a scan as a `.orgxray` file and reopen it later. This suits the 5 MB storage limit and makes a clear privacy promise.
2. **The model proposes and the code checks.** Each agent step returns JSON. Apex checks it against a fixed contract before the browser acts on it: allowed tools only, size caps, no HTML. The tools themselves are plain JavaScript over the index, so the model never runs anything.
3. **Model access: the Einstein Models API (`aiplatform.ModelsAPI`) called directly from guest Apex.** Phase 0 proved the guest user can call it synchronously (about 1–2 s), so no Named Credential is needed. This keeps chat fast and simple.
4. **RAG over Salesforce docs:** order of execution, approvals, flows and release notes, chunked and embedded once with the Models API embeddings endpoint. The vectors are stored as a static resource (about 2 MB of file storage, not data storage). Similarity search runs in the browser, and every answer cites its source.
5. **The demo org replays a real recorded run.** It's recorded once from the live agent loop, so it's free, instant and good for videos, and it's labelled "Replay of a real AI run". Upload and live modes use live AI with daily caps.
6. **Agentforce:** not used in the core loop, because the loop needs tight JSON control and speed. It's an option in phase 5: Ada as an Agentforce agent on the site through the Agent API, with the findings passed as context. I'd decide after phase 3.

---

## 4. The agent crew

| Agent                   | Job                                        | Tools                                                                                                                |
| ----------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **Theo** (surveyor)     | What the business is                       | `listObjects`, `recordCounts`                                                                                        |
| **Ada** (archaeologist) | Digs for how things happen                 | `getPicklist`, `listFlows`, `getFlow`, `listTriggers`, `getApex`, `listApprovals`, `getApproval`, `listIntegrations` |
| **Noor** (analyst)      | Links findings, counts                     | `countBy` (aggregates only), `linkFindings`                                                                          |
| **Rex** (skeptic)       | Challenges unproven claims                 | `verify` (re-runs a tool to confirm)                                                                                 |
| **Pip** (courier)       | Visual only: carries findings to the board | none                                                                                                                 |

**Loop:** the browser keeps a question queue. Each step sends the open questions, the findings so far and the last tool result to `agentStep`. The response says who acts, what they say and which tool to call next. It stops when the questions are answered or the step budget runs out: about 40 steps for a small org, a hard cap of 120.

**Step contract** (validated in Apex):

```json
{
  "agent": "ada | theo | noor | rex",
  "say": "≤ 120 chars, shown in the speech bubble",
  "caption": { "plain": "≤ 200 chars", "tech": "≤ 200 chars" },
  "action": { "tool": "<allowed tool>", "args": { } } | null,
  "finding": {
    "id": "slug", "title": "≤ 80", "evidence": "≤ 200", "source": "≤ 120",
    "confidence": "confirmed | likely | guess",
    "group": "sell | approve | fulfil | bill | service",
    "plain": "≤ 300, no Salesforce terms", "year": 2018
  } | null,
  "question": { "id": "q3", "status": "dig | done | fixed", "answer": "≤ 80" } | null,
  "challenge": { "text": "≤ 120" } | null,
  "done": false
}
```

**Chat contract:** the request carries the agent, the question, the plain or technical style and the findings so far. The response carries an answer, sources and a flag saying whether it was answered from findings. Agents answer **only from the findings**. If something hasn't been found yet, they say so.

**Prompt injection:** metadata text (descriptions, help text, Apex comments) is wrapped as data and never treated as instructions. The contract stops the model taking any action outside the tool list, and nothing ever writes to the visitor's org.

---

## 5. Our org: what's stored (5 MB budget)

| Item                | Type                                                           | Size                                   |
| ------------------- | -------------------------------------------------------------- | -------------------------------------- |
| `Xray_Setting__mdt` | Custom metadata: kill switch, daily cap, step cap, model names | 0 data storage                         |
| `Xray_Usage__c`     | One row per day: runs, model calls                             | about 2 KB a day, purged after 30 days |
| Static resources    | three.js r128, JSZip (pinned), demo bundle, docs vectors       | about 4 MB file storage (20 MB limit)  |

No visitor scans, prompts or transcripts are stored.

---

## 6. Components

**LWC** (API 68, Light DOM where styling needs it, complex template expressions, container queries):

| Component                             | Role                                                        |
| ------------------------------------- | ----------------------------------------------------------- |
| `xrayApp`                             | Shell, routing, audience lens, state manager store          |
| `xrayConnect`                         | Demo / upload / live entry                                  |
| `xrayLiveStrip`                       | Phase stepper, caption, counter                             |
| `xrayScene`                           | three.js voxel diorama, crew, camera, X-ray, HTML labels    |
| `xrayBoard`                           | Evidence board (pinned, or grouped for big orgs), filter    |
| `xrayCaseFile`                        | Questions, working theory, crew list                        |
| `xrayChat`                            | Crew chat drawer, plain/technical                           |
| `xrayProcess`                         | Swimlane, "Play the process"                                |
| `xrayStory` + `xrayLens`              | Plain-words story, role summary, "I'm new here" cheat sheet |
| `xrayCascade`                         | Save cascade (phase 4)                                      |
| `xrayDoctor`, `xrayRadar`, `xrayCard` | Health, release radar, share card (phase 5)                 |

**JS modules:** `xrayStore` (state), `xrayIndex` (metadata parser), `xrayTools`, `xrayAgentLoop`, `xrayRag`, `xrayVoxel` (scene builder), `xrayReplay`.

**Apex** (`with sharing` by default; guest services use explicit system mode only where needed):

| Class              | Role                                                                 |
| ------------------ | -------------------------------------------------------------------- |
| `XrayController`   | Guest `@AuraEnabled`: `agentStep`, `chat`, `embedQuery`, `getConfig` |
| `XrayModels`       | Models API client behind an interface (stubbed in tests)             |
| `XrayPrompts`      | Prompt builders per agent and per style                              |
| `XrayContract`     | Parses and validates every model response                            |
| `XrayLimits`       | Kill switch, daily cap, step cap                                     |
| `XrayUsageCleanup` | Scheduled purge of old usage rows                                    |

Every class has tests. The target is above 90% coverage, with tests that assert behaviour, not just coverage.

---

## 7. Phases and "done when"

Each phase is verified **on the live public site as a guest** (headless Chrome), and I'll tell you plainly what worked and what didn't.

| Phase                               | Scope                                                                                                                                                                                                                                                                                                                  | Done when                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **0 · Setup + spikes**              | SFDX project on API 68, CI (GitHub Actions: validate on PR, deploy + publish + smoke on `main`), LWR site `watchitbuild` public. **Spikes:** (a) three.js in LWC under Lightning Web Security; (b) guest → Named Credential → Models API; (c) embeddings endpoint; (d) live connect via PKCE + CORS on a spare dev org | Site loads for guests, CI green, smoke test green, a written yes/no on each spike             |
| **1 · Demo dig**                    | 3D scene, crew, board, case file, live strip, process, story, lens. Demo org driven by a recorded real agent run                                                                                                                                                                                                       | A guest watches the full dig on the live site, clicks agents, sees the process and story      |
| **2 · Your org (upload)**           | CLI command + zip upload, metadata indexer, live agent loop with caps, big-org mode (grouped board, lookup cap)                                                                                                                                                                                                        | A real dev-org export produces a sensible process with sources; a large export stays readable |
| **3 · Chat + RAG**                  | Grounded crew chat, plain/technical, docs RAG with citations, roles + "I'm new here"                                                                                                                                                                                                                                   | Answers cite sources, never claim unfound things, and match the chosen role                   |
| **4 · Live connect + Save cascade** | Only if spike (d) passed. Save cascade "predicted" from metadata first                                                                                                                                                                                                                                                 | Guest connects a sandbox and sees the cascade for a chosen object                             |
| **5 · Doctor, radar, polish**       | Health report and patches, release radar, share card, README with architecture diagram, optional Agentforce Ada                                                                                                                                                                                                        | All tabs work as a guest; README done; video recorded                                         |

After each phase: a short LinkedIn video recorded with `director.mjs`.

### Phase 0 results (20 Nov 2026, checked on the live site as a logged-out guest)

| Spike                                     | Result                                                                                                                                                                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) three.js under Lightning Web Security | ✅ three.js r128 renders with WebGL 2 inside an LWC on the LWR site                                                                                                                                                                                            |
| (b) Guest → Models API                    | ✅ Direct `aiplatform.ModelsAPI` call from guest Apex, about 1–2 s. No Named Credential needed                                                                                                                                                                 |
| (c) Embeddings                            | ✅ `sfdc_ai__DefaultOpenAITextEmbeddingAda_002`, 1,536 dimensions, about 0.8 s                                                                                                                                                                                 |
| (d) Live connect (browser → org API)      | ✅ Mechanism proven: browser code on the site called an org REST endpoint (HTTP 200) through a CSP trusted site (`*.my.salesforce.com`) and the org's CORS list. **Still open:** the OAuth PKCE login from a _different_ org, which needs a second org to test |

---

## 8. Risks

| Risk                                                     | Impact              | Plan                                                                                                                       |
| -------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| three.js blocked or slow under Lightning Web Security    | No 3D               | Spike in phase 0. Fallback: the 2D SVG dig (already mocked)                                                                |
| Live connect not possible (Remote Site/CORS)             | No live mode        | Upload mode covers it. Decided after spike (d)                                                                             |
| Einstein request limits in a dev org                     | Live runs stop      | Demo uses replay; daily cap; kill switch; clear "come back tomorrow" message                                               |
| Model returns bad JSON                                   | Broken step         | Contract validation, one retry, then a graceful "Ada lost the thread" message                                              |
| Prompt injection via metadata text                       | Wrong or odd output | Data wrapping, a fixed tool list, no write tools                                                                           |
| "Read-only" is our promise, not enforced by OAuth scopes | Trust               | Advise connecting as a read-only user; the code has no write paths, except an opt-in recorded save in a sandbox (phase 4+) |

---

## 9. Ground rules (from the brief)

- Only the `watchitbuild` org. Always pass `--target-org watchitbuild`.
- Fictional companies only. No employer or client names. No job-seeking wording.
- Commit or push only when asked. Branch off `main` first.
- Deploy only changed files with `RunSpecifiedTests`. Run `sf community publish` after LWC changes.
