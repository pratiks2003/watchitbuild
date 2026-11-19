// Guest smoke test for the public Org X-Ray site.
// Opens the site in a fresh, logged-out headless Chrome, waits for the page,
// reads every [data-check] status (piercing shadow roots) and saves a screenshot.
// Usage: node scripts/smoke/guest-smoke.mjs <siteUrl> [screenshot.png] [waitMs]
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [siteUrl, shotPath = "smoke.png", waitMs = "20000"] =
  process.argv.slice(2);
if (!siteUrl) {
  console.error(
    "Usage: node guest-smoke.mjs <siteUrl> [screenshot.png] [waitMs]"
  );
  process.exit(2);
}
const CHROME =
  process.env.CHROME_PATH ??
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "google-chrome");
const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), "xray-smoke-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--window-size=1280,1000",
    "--no-first-run",
    "about:blank"
  ],
  { stdio: "ignore" }
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = tabs.find((t) => t.type === "page");
      if (page) return new WebSocket(page.webSocketDebuggerUrl);
    } catch {
      /* chrome still starting */
    }
    await sleep(200);
  }
  throw new Error("Chrome did not start");
}

let nextId = 0;
const pending = new Map();
const consoleErrors = [];
function send(ws, method, params = {}) {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
}

const PIERCE = `(() => {
  const out = [];
  const walk = (root) => {
    root.querySelectorAll('[data-check]').forEach(el => out.push({
      check: el.dataset.check, status: el.dataset.status,
      text: el.textContent.replace(/\\s+/g, ' ').trim()
    }));
    root.querySelectorAll('*').forEach(el => el.shadowRoot && walk(el.shadowRoot));
  };
  walk(document);
  return JSON.stringify({ title: document.title, url: location.href, checks: out });
})()`;

let exitCode = 1;
try {
  const ws = await connect();
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result ?? msg.error);
      pending.delete(msg.id);
    } else if (msg.method === "Runtime.exceptionThrown") {
      consoleErrors.push(
        msg.params.exceptionDetails?.exception?.description ?? "exception"
      );
    } else if (
      msg.method === "Runtime.consoleAPICalled" &&
      msg.params.type === "error"
    ) {
      consoleErrors.push(
        msg.params.args.map((a) => a.value ?? a.description).join(" ")
      );
    }
  });
  await send(ws, "Runtime.enable");
  await send(ws, "Page.enable");
  await send(ws, "Page.navigate", { url: siteUrl });

  const deadline = Date.now() + Number(waitMs);
  let report;
  while (Date.now() < deadline) {
    await sleep(1000);
    const res = await send(ws, "Runtime.evaluate", {
      expression: PIERCE,
      returnByValue: true
    });
    report = JSON.parse(res?.result?.value ?? "{}");
    const settled =
      report.checks?.length &&
      report.checks.every((c) => c.status === "ok" || c.status === "failed");
    if (settled) break;
  }
  const shot = await send(ws, "Page.captureScreenshot", { format: "png" });
  writeFileSync(shotPath, Buffer.from(shot.data, "base64"));

  console.log(
    JSON.stringify(
      {
        ...report,
        consoleErrors: consoleErrors.slice(0, 5),
        screenshot: shotPath
      },
      null,
      2
    )
  );
  const allOk =
    report?.checks?.length > 0 && report.checks.every((c) => c.status === "ok");
  exitCode = allOk ? 0 : 1;
  ws.close();
} catch (error) {
  console.error("Smoke test error:", error.message);
} finally {
  chrome.kill();
  process.exit(exitCode);
}
