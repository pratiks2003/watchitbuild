// Records a REAL investigation of the demo org with the live model, through the public
// guest endpoint, using the exact same loop and tools the browser uses.
// Output: force-app/main/default/lwc/xrayDemoRun/xrayDemoRun.js (replayed by the site).
//
// Usage: node scripts/record-demo-run.mjs [maxSteps]
// Needs the Salesforce CLI logged in to the watchitbuild org (to look up the class Id).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE =
  "https://orgfarm-bd59095f65-dev-ed.develop.my.site.com/watchitbuild";
const maxSteps = Number(process.argv[2] ?? 40);

// Load the LWC modules in Node: copy them and rewrite "c/xrayX" imports to relative files.
const work = mkdtempSync(join(tmpdir(), "xray-rec-"));
for (const name of ["xrayTools", "xrayAgentLoop", "xrayDemoOrg"]) {
  const src = readFileSync(
    join(root, "force-app/main/default/lwc", name, `${name}.js`),
    "utf8"
  );
  writeFileSync(
    join(work, `${name}.mjs`),
    src.replace(/from "c\/(xray\w+)"/g, 'from "./$1.mjs"')
  );
}
const { AgentLoop } = await import(
  pathToFileURL(join(work, "xrayAgentLoop.mjs"))
);
const { DEMO_ORG } = await import(pathToFileURL(join(work, "xrayDemoOrg.mjs")));

const query = JSON.parse(
  execFileSync(
    "sf",
    [
      "data",
      "query",
      "--target-org",
      "watchitbuild",
      "--json",
      "--query",
      "SELECT Id FROM ApexClass WHERE Name = 'XrayController'"
    ],
    {
      encoding: "utf8"
    }
  )
);
const classId = query.result.records[0].Id.slice(0, 15);

async function callApex(method, params) {
  const res = await fetch(
    `${SITE}/webruntime/api/apex/execute?language=en-US&asGuest=true&htmlEncode=false`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        namespace: "",
        classname: `@udd/${classId}`,
        method,
        isContinuation: false,
        params,
        cacheable: false
      })
    }
  );
  const body = await res.json();
  if (!res.ok)
    throw new Error(
      `${method}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`
    );
  return body.returnValue;
}

const api = {
  agentStep: async (context) =>
    JSON.parse(
      await callApex("agentStep", { contextJson: JSON.stringify(context) })
    ),
  summarize: async (context) =>
    JSON.parse(
      await callApex("summarize", { contextJson: JSON.stringify(context) })
    )
};

const started = Date.now();
const loop = new AgentLoop({
  index: DEMO_ORG,
  api,
  maxSteps,
  onEvent: (e) => {
    const t = ((Date.now() - started) / 1000).toFixed(1).padStart(6);
    if (e.type === "step") {
      const s = e.step;
      const act = s.action
        ? `${s.action.tool}(${JSON.stringify(s.action.args)})`
        : "-";
      console.log(
        `${t}s ${s.agent.padEnd(5)} ${act.padEnd(60).slice(0, 60)} ${s.finding ? `FINDING ${s.finding.id} [${s.finding.confidence}]` : ""}${s.challenge ? ` CHALLENGE "${s.challenge.text}"` : ""}${s.question ? ` ${s.question.id}:${s.question.status}` : ""}`
      );
    } else if (e.type === "error") {
      console.log(`${t}s ERROR ${e.error?.message ?? e.error}`);
    } else if (e.type === "summary") {
      console.log(
        `${t}s SUMMARY: ${e.summary.process.steps.length} process steps, ${e.summary.story.length} story lines`
      );
    }
  }
});
const run = await loop.run();
run.model = "recorded live through the guest endpoint";
run.durationMs = Date.now() - started;

const out = join(root, "force-app/main/default/lwc/xrayDemoRun/xrayDemoRun.js");
writeFileSync(
  out,
  `/**
 * A real Org X-Ray investigation of the demo org, recorded with the live model through the
 * public guest endpoint by scripts/record-demo-run.mjs. Generated file: do not edit by hand.
 */
export const DEMO_RUN = ${JSON.stringify(run)};
`
);
const answered = run.questions.filter((q) => q.status !== "open").length;
console.log(
  `\nSteps: ${run.steps.length}, findings: ${run.findings.length}, questions answered: ${answered}/${run.questions.length}, time: ${(run.durationMs / 1000).toFixed(0)}s`
);
console.log(`Saved ${out}`);
