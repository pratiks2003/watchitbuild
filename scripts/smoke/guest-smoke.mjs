// Guest smoke test for the public Org X-Ray site.
// Opens the site in a fresh, logged-out headless Chrome, waits for the page,
// reads every [data-check] status (piercing shadow roots) and saves a screenshot.
// Usage: node scripts/smoke/guest-smoke.mjs <siteUrl> [screenshot.png] [waitMs]
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const interact = args.includes("--interact");
const [siteUrl, shotPath = "smoke.png", waitMs = "20000"] = args.filter(
  (a) => a !== "--interact"
);
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
    // Software WebGL by default (works on CI); GPU=1 uses the real GPU for smooth, true-timing captures.
    ...(process.env.GPU
      ? ["--use-angle=metal", "--enable-gpu"]
      : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]),
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
  const seen = new Set();
  const walk = (root) => {
    if (seen.has(root)) return;
    seen.add(root);
    root.querySelectorAll('[data-check]').forEach(el => out.some(o => o.el === el) || out.push({ el,
      check: el.dataset.check, status: el.dataset.status,
      text: el.textContent.replace(/\\s+/g, ' ').trim()
    }));
    root.querySelectorAll('*').forEach(el => el.shadowRoot && walk(el.shadowRoot));
  };
  walk(document);
  return JSON.stringify({ title: document.title, url: location.href, checks: out.map(({ el, ...rest }) => rest) });
})()`;

// Visitor flow: skip to results, open Ada's chat from her name tag, ask a suggested question.
const DEEP = `const deepAll = (sel) => { const out = []; const seen = new Set(); const walk = (r) => { if (seen.has(r)) return; seen.add(r); r.querySelectorAll(sel).forEach(e => out.push(e)); r.querySelectorAll('*').forEach(e => e.shadowRoot && walk(e.shadowRoot)); }; walk(document); return out; };`;
async function evaluate(ws, body) {
  const res = await send(ws, "Runtime.evaluate", {
    expression: `(() => { ${DEEP} ${body} })()`,
    returnByValue: true,
    awaitPromise: true
  });
  return res?.result?.value;
}
async function runInteraction(ws) {
  const skipped = await evaluate(
    ws,
    `const b = deepAll('button').find(x => x.textContent.trim() === 'Skip to results'); if (b) b.click(); return Boolean(b);`
  );
  await sleep(1500);
  const opened = await evaluate(
    ws,
    `const t = deepAll('button.tag3').find(x => x.textContent.includes('Ada')); if (t) t.click(); return Boolean(t);`
  );
  await sleep(1200);
  const asked = await evaluate(
    ws,
    `const s = deepAll('.sugg button')[0]; if (s) s.click(); return s ? s.textContent.trim() : null;`
  );
  await sleep(6000);
  const answer = await evaluate(
    ws,
    `const m = deepAll('.m.a'); return m.length ? m[m.length - 1].textContent.replace(/\\s+/g, ' ').trim() : null;`
  );
  // The finished investigation must be on the board, so the story must be the real one.
  const ok = Boolean(
    skipped && opened && asked && answer && answer.includes("outdoor gear")
  );
  return { ok, skipped, opened, asked, answer };
}

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
  if (interact) {
    report.interaction = await runInteraction(ws);
  }
  // Optional: hold before the screenshot (e.g. HOLD_MS=20000 to catch the dig mid-way).
  if (process.env.HOLD_MS) await sleep(Number(process.env.HOLD_MS));
  // Optional: CLICK="Button text" presses that button (shadow DOM included) before the filmstrip.
  if (process.env.CLICK) {
    await evaluate(
      ws,
      `const b = deepAll('button').find(x => x.textContent.trim() === ${JSON.stringify(process.env.CLICK)}); if (b) b.click(); return Boolean(b);`
    );
  }
  // Optional filmstrip: FILMSTRIP="5000,10000,20000" saves one screenshot per delay (ms from now).
  if (process.env.FILMSTRIP) {
    const start = Date.now();
    for (const at of process.env.FILMSTRIP.split(",").map(Number)) {
      await sleep(Math.max(0, at - (Date.now() - start)));
      const frame = await send(ws, "Page.captureScreenshot", { format: "png" });
      writeFileSync(
        shotPath.replace(/\.png$/, `-${at}.png`),
        Buffer.from(frame.data, "base64")
      );
    }
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
    report?.checks?.length > 0 &&
    report.checks.every((c) => c.status === "ok") &&
    (!interact || report.interaction?.ok === true);
  exitCode = allOk ? 0 : 1;
  ws.close();
} catch (error) {
  console.error("Smoke test error:", error.message);
} finally {
  chrome.kill();
  process.exit(exitCode);
}
