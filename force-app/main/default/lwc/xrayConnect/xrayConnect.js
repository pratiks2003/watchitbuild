/**
 * Live connect: the visitor signs in to their own org and their browser reads its
 * metadata directly. OAuth 2.0 authorization code + PKCE with a public client (no
 * secret). The code is exchanged at the visitor's own My Domain, so the access token
 * never touches our server; it lives in this tab's memory only.
 *
 * Visitor-org setup (their admin, once): add this site's origin to Setup > CORS, and
 * tick "Enable CORS for OAuth endpoints".
 */
import { readTrigger, readClass, flowFires, signalsOf } from "c/xrayIndexer";

/** Public client ID of the "Org X-Ray" connected app (not a secret: PKCE public client). */
export const CLIENT_ID =
  "3MVG91oqviqJKoEFkOuhB_Rqa.Hj5fNuMLOc6Fw1TqogHGA2Xb_EexU5kkuCGJtgqRjICnbo4fYwKYJncOQD3";
const API = "v68.0";
const PENDING_KEY = "orgxray.oauth";
const KEY_OBJECTS = [
  "Account",
  "Contact",
  "Lead",
  "Opportunity",
  "Case",
  "Quote",
  "Order",
  "Product2",
  "Contract",
  "Campaign"
];

/* ---------- sign-in ---------- */

/** Accepts "acme.my.salesforce.com", a full URL, or a sandbox My Domain; returns a clean host or null. */
export function cleanDomain(input) {
  const host = String(input ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  // My Domain only: every org has one, and it is the only host this site's CSP trusts.
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.my\.salesforce\.com$/.test(host)
    ? host
    : null;
}

const base64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function randomString(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return base64url(digest);
}

/** Where Salesforce sends the visitor back: this site's home page. */
export function redirectUri(location = window.location) {
  const path = location.pathname.replace(/[^/]*$/, "");
  return `${location.origin}${path}`;
}

/** Starts the sign-in: remembers the PKCE verifier for this tab and goes to the visitor's login page. */
export async function startSignIn(domainInput) {
  const domain = cleanDomain(domainInput);
  if (!domain)
    throw new Error(
      "Enter your org's My Domain, like acme.my.salesforce.com or acme--uat.sandbox.my.salesforce.com."
    );
  const verifier = randomString(48);
  const state = randomString(16);
  const redirect = redirectUri();
  sessionStorage.setItem(
    PENDING_KEY,
    JSON.stringify({ verifier, state, domain, redirect })
  );
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirect,
    scope: "api",
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: "S256"
  });
  window.location.assign(
    `https://${domain}/services/oauth2/authorize?${params}`
  );
}

/** True when this page load is the return from a sign-in started in this tab. */
export function isSignInReturn(location = window.location) {
  const q = new URLSearchParams(location.search);
  return (
    (q.has("code") || q.has("error")) &&
    q.has("state") &&
    Boolean(sessionStorage.getItem(PENDING_KEY))
  );
}

/**
 * Finishes the sign-in: checks state, exchanges the code (PKCE) in the browser, cleans the URL.
 * @returns {Promise<{ token: string, instanceUrl: string, domain: string }>}
 */
export async function finishSignIn(location = window.location) {
  const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null");
  sessionStorage.removeItem(PENDING_KEY);
  const q = new URLSearchParams(location.search);
  window.history.replaceState(null, "", location.pathname);
  if (!pending)
    throw new Error(
      "This sign-in was started somewhere else. Please start again."
    );
  if (q.get("error"))
    throw new Error(q.get("error_description") || "Sign-in was cancelled.");
  if (q.get("state") !== pending.state)
    throw new Error("The sign-in did not match. Please start again.");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: q.get("code"),
    client_id: CLIENT_ID,
    redirect_uri: pending.redirect,
    code_verifier: pending.verifier
  });
  let response;
  try {
    response = await fetch(`https://${pending.domain}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
  } catch {
    throw new Error(
      'Your org blocked the sign-in from this site. Ask your admin to add this site under Setup > CORS and tick "Enable CORS for OAuth endpoints".'
    );
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token)
    throw new Error(
      data.error_description || "Your org did not accept the sign-in."
    );
  return {
    token: data.access_token,
    instanceUrl: data.instance_url,
    domain: pending.domain
  };
}

/* ---------- reading the org ---------- */

const PARALLEL = 6; // browsers allow ~6 requests per host; stay polite to the org's API
const COUNT_BATCH = 100;
const SYSTEM_SUFFIX = /(Share|History|Feed|ChangeEvent|Tag|__mdt|__e|__x|__b)$/;

function apiClient({ token, instanceUrl }, fetchImpl = fetch) {
  const get = async (path) => {
    const response = await fetchImpl(`${instanceUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => []);
      throw new Error(detail?.[0]?.message ?? `HTTP ${response.status}`);
    }
    return response.json();
  };
  /** Every page of a query. onPage(records, soFar, total) lets callers process and report as it goes. */
  const query = async (soql, tooling = false, onPage) => {
    let page = await get(
      `/services/data/${API}/${tooling ? "tooling/" : ""}query?q=${encodeURIComponent(soql)}`
    );
    const all = [];
    for (;;) {
      all.push(...page.records);
      onPage?.(page.records, all.length, page.totalSize ?? all.length);
      if (!page.nextRecordsUrl) break;
      // eslint-disable-next-line no-await-in-loop -- pages must be fetched in order
      page = await get(page.nextRecordsUrl);
    }
    return all;
  };
  /** Tooling returns `Metadata` only one row at a time. */
  const metadataOf = (sobject, id) =>
    query(`SELECT Metadata FROM ${sobject} WHERE Id = '${id}'`, true).then(
      (rows) => rows[0]?.Metadata ?? null
    );
  return { get, query, metadataOf };
}

/** Runs fn over items, a few at a time, reporting progress; failures become null. */
async function pool(items, fn, onDone) {
  const results = new Array(items.length).fill(null);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        // eslint-disable-next-line no-await-in-loop -- each worker handles one item at a time
        results[i] = await fn(items[i]);
      } catch {
        results[i] = null;
      }
      done++;
      onDone?.(done, items.length);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return results;
}

const yearOf = (iso) => (iso ? Number(String(iso).slice(0, 4)) : null);
function valueOf(v) {
  if (!v) return undefined;
  return Object.values(v).find((x) => x !== null && x !== undefined);
}
function actionLabel(a) {
  if (a.actionType === "apex") return `Apex ${a.actionName}`;
  return `${a.actionType ?? "Action"}: ${a.actionName}`;
}
const fmt = (n) => Number(n).toLocaleString("en-US");

/** Flow (or Process Builder) metadata JSON → index component. */
export function flowComponent(row, meta) {
  const start = meta?.start ?? {};
  const pmv = Object.fromEntries(
    (meta?.processMetadataValues ?? []).map((v) => [v.name, valueOf(v.value)])
  );
  const isProcess = row.ProcessType === "Workflow";
  const object = start.object ?? pmv.ObjectType ?? null;
  const fires = isProcess
    ? object && {
        timing: "after",
        on:
          pmv.TriggerType === "onCreateOnly"
            ? ["create"]
            : ["create", "update"],
        order: null
      }
    : flowFires(
        start.triggerType,
        start.recordTriggerType,
        meta?.triggerOrder,
        (start.scheduledPaths ?? []).map((p) => p.label ?? p.name)
      );
  const actions = [
    ...(meta?.recordCreates ?? []).map((r) => `Create ${r.object ?? "record"}`),
    ...(meta?.recordUpdates ?? []).map(
      (r) =>
        `Update ${r.object ?? (r.inputReference === "$Record" ? "this record" : r.inputReference) ?? "record"}`
    ),
    ...(meta?.recordDeletes ?? []).map((r) => `Delete ${r.object ?? "record"}`),
    ...(meta?.actionCalls ?? []).map(actionLabel),
    ...(meta?.subflows ?? []).map((f) => `Subflow ${f.flowName}`)
  ];
  const filters = (start.filters ?? []).map((x) =>
    `${x.field} ${x.operator} ${valueOf(x.value) ?? ""}`.trim()
  );
  const when = {
    RecordAfterSave: "after save",
    RecordBeforeSave: "before save",
    RecordBeforeDelete: "before delete",
    Scheduled: "scheduled",
    PlatformEvent: "platform event"
  }[start.triggerType];
  return {
    name: row.Definition?.DeveloperName ?? row.Id,
    type: isProcess ? "processBuilder" : "flow",
    object,
    year: yearOf(row.CreatedDate),
    active: true,
    fires: fires || undefined,
    detail: {
      label: meta?.label ?? row.MasterLabel,
      trigger: when
        ? `Record-triggered, ${when}${start.recordTriggerType ? ` (${start.recordTriggerType})` : ""}`
        : isProcess
          ? "Process (Process Builder)"
          : (row.ProcessType ?? "Flow"),
      entryCriteria:
        start.filterFormula ??
        (filters.length
          ? filters.join(
              start.filterLogic && start.filterLogic !== "and"
                ? ` ${start.filterLogic} `
                : " AND "
            )
          : undefined),
      decisions: (meta?.decisions ?? []).length || undefined,
      actions: [...new Set(actions)].slice(0, 12),
      signals: meta ? signalsOf(JSON.stringify(meta)) : undefined,
      partial: meta ? undefined : true
    }
  };
}

/**
 * Reads the WHOLE org's automation (metadata, plus aggregate counts only; never records)
 * through the visitor's token, and returns an index in the same shape as c/xrayDemoOrg.
 * Nothing is capped: big orgs take longer, and progress is reported throughout.
 * If the user lacks access to something, it is noted in stats and the rest still works.
 */
export async function readOrg(
  session,
  { onProgress = () => {}, fetchImpl } = {}
) {
  const api = apiClient(session, fetchImpl);
  const out = { objects: [], components: [] };
  const counts = {};
  const stats = { skipped: [], read: {} };
  const step = async (label, fn) => {
    onProgress(label);
    try {
      await fn();
    } catch (error) {
      stats.skipped.push(`${label}: ${error.message}`);
    }
  };
  const tally = (type, n) => {
    stats.read[type] = (stats.read[type] ?? 0) + n;
  };

  let orgName = "Your org";
  await step("Reading the org name", async () => {
    orgName =
      (await api.query("SELECT Name FROM Organization"))[0]?.Name ?? orgName;
  });

  // Every object name, so code that mentions any object can be linked to it.
  const catalog = new Map();
  let objectNames = new Set();
  await step("Listing objects", async () => {
    const global = await api.get(`/services/data/${API}/sobjects`);
    global.sobjects
      .filter((o) => o.queryable && !SYSTEM_SUFFIX.test(o.name))
      .forEach((o) => catalog.set(o.name, o));
    objectNames = new Set(catalog.keys());
  });

  await step("Reading flows", async () => {
    const rows = await api.query(
      "SELECT Id, Definition.DeveloperName, MasterLabel, ProcessType, CreatedDate FROM Flow WHERE Status = 'Active' AND Definition.NamespacePrefix = null",
      true
    );
    const metas = await pool(
      rows,
      (r) => api.metadataOf("Flow", r.Id),
      (done, total) =>
        onProgress(`Reading flows: ${fmt(done)} of ${fmt(total)}`)
    );
    rows.forEach((r, i) => out.components.push(flowComponent(r, metas[i])));
    tally("flows", rows.length);
    const partial = metas.filter((m) => !m).length;
    if (partial)
      stats.skipped.push(`Flow details: ${partial} flows could not be opened`);
  });

  await step("Reading triggers", async () => {
    await api.query(
      "SELECT Name, TableEnumOrId, Status, CreatedDate, Body FROM ApexTrigger WHERE NamespacePrefix = null",
      true,
      (records, soFar, total) => {
        records.forEach((t) => {
          readTrigger(
            t.Name,
            t.Body ?? "",
            `<status>${t.Status}</status>`,
            out
          );
          const c = out.components[out.components.length - 1];
          c.year = yearOf(t.CreatedDate);
          c.object = t.TableEnumOrId ?? c.object;
        });
        tally("triggers", records.length);
        onProgress(`Reading triggers: ${fmt(soFar)} of ${fmt(total)}`);
      }
    );
  });

  await step("Reading Apex classes", async () => {
    // Processed page by page, so even thousands of classes stay light on memory.
    await api.query(
      "SELECT Name, Status, CreatedDate, Body FROM ApexClass WHERE NamespacePrefix = null",
      true,
      (records, soFar, total) => {
        records.forEach((c) => {
          const before = out.components.length;
          readClass(
            c.Name,
            c.Body ?? "",
            `<status>${c.Status}</status>`,
            objectNames,
            out
          );
          if (out.components.length > before)
            out.components[out.components.length - 1].year = yearOf(
              c.CreatedDate
            );
        });
        tally("classes", records.length);
        onProgress(`Reading Apex classes: ${fmt(soFar)} of ${fmt(total)}`);
      }
    );
  });

  await step("Reading validation rules", async () => {
    const rules = await api.query(
      "SELECT Id, ValidationName, Active, ErrorMessage, CreatedDate, EntityDefinition.QualifiedApiName FROM ValidationRule WHERE NamespacePrefix = null",
      true
    );
    const metas = await pool(
      rules,
      (r) => api.metadataOf("ValidationRule", r.Id),
      (done, total) =>
        onProgress(`Reading validation rules: ${fmt(done)} of ${fmt(total)}`)
    );
    rules.forEach((r, i) => {
      out.components.push({
        name: r.ValidationName,
        type: "validation",
        object: r.EntityDefinition?.QualifiedApiName ?? null,
        year: yearOf(r.CreatedDate),
        active: r.Active,
        detail: {
          rule: metas[i]?.errorConditionFormula?.slice(0, 300),
          message: r.ErrorMessage,
          signals: signalsOf(metas[i]?.errorConditionFormula)
        }
      });
    });
    tally("validation rules", rules.length);
  });

  await step("Reading workflow rules", async () => {
    const rules = await api.query(
      "SELECT Id, Name, TableEnumOrId, CreatedDate FROM WorkflowRule WHERE NamespacePrefix = null",
      true
    );
    const metas = await pool(
      rules,
      (r) => api.metadataOf("WorkflowRule", r.Id),
      (done, total) =>
        onProgress(`Reading workflow rules: ${fmt(done)} of ${fmt(total)}`)
    );
    rules.forEach((r, i) => {
      const m = metas[i];
      out.components.push({
        name: r.Name,
        type: "workflow",
        object: r.TableEnumOrId,
        year: yearOf(r.CreatedDate),
        active: m ? m.active !== false : true,
        fires: {
          on:
            m?.triggerType === "onCreateOnly"
              ? ["create"]
              : ["create", "update"]
        },
        detail: {
          entryCriteria:
            m?.formula ??
            ((m?.criteriaItems ?? [])
              .map((c) => `${c.field} ${c.operation} ${c.value ?? ""}`.trim())
              .join(" AND ") ||
              undefined),
          actions: (m?.actions ?? [])
            .map((a) => `${a.type}: ${a.name}`)
            .slice(0, 8),
          partial: m ? undefined : true
        }
      });
    });
    tally("workflow rules", rules.length);
  });

  await step("Reading approval processes", async () => {
    const approvals = await api.query(
      "SELECT DeveloperName, Name, TableEnumOrId, State, CreatedDate FROM ProcessDefinition WHERE Type = 'Approval'"
    );
    approvals.forEach((a) => {
      out.components.push({
        name: a.DeveloperName,
        type: "approval",
        object: a.TableEnumOrId,
        year: yearOf(a.CreatedDate),
        active: a.State === "Active",
        detail: { label: a.Name }
      });
    });
    tally("approvals", approvals.length);
  });

  await step("Reading named credentials", async () => {
    const creds = await api.query(
      "SELECT DeveloperName, Endpoint, CreatedDate FROM NamedCredential"
    );
    creds.forEach((n) => {
      out.components.push({
        name: n.DeveloperName,
        type: "namedCredential",
        object: null,
        year: yearOf(n.CreatedDate),
        active: true,
        detail: { endpoint: n.Endpoint }
      });
    });
  });

  await step("Reading queues", async () => {
    const queues = await api.query(
      "SELECT DeveloperName, Name, CreatedDate, (SELECT SobjectType FROM QueueSobjects) FROM Group WHERE Type = 'Queue'"
    );
    queues.forEach((g) => {
      const objects = (g.QueueSobjects?.records ?? []).map(
        (r) => r.SobjectType
      );
      out.components.push({
        name: g.DeveloperName,
        type: "queue",
        object: objects[0] ?? null,
        year: yearOf(g.CreatedDate),
        active: true,
        detail: { label: g.Name, objects }
      });
    });
  });

  await step("Reading stages and statuses", async () => {
    let convertedStatus = [];
    try {
      convertedStatus = (
        await api.query(
          "SELECT MasterLabel FROM LeadStatus WHERE IsConverted = true"
        )
      ).map((r) => r.MasterLabel);
    } catch {
      // no Lead access
    }
    for (const [object, field] of [
      ["Opportunity", "StageName"],
      ["Case", "Status"],
      ["Lead", "Status"]
    ]) {
      if (!catalog.has(object)) continue;
      // eslint-disable-next-line no-await-in-loop -- a few small describes, in order
      const describe = await api.get(
        `/services/data/${API}/sobjects/${object}/describe`
      );
      const values = (
        describe.fields.find((f) => f.name === field)?.picklistValues ?? []
      )
        .filter((v) => v.active)
        .map((v) => v.value);
      if (values.length)
        out.components.push({
          name: `${object}.${field}`,
          type: "picklist",
          object,
          year: null,
          active: true,
          detail: {
            values: values.slice(0, 30),
            convertedStatus:
              object === "Lead" && convertedStatus.length
                ? convertedStatus
                : undefined
          }
        });
      // Aggregate counts only: no record is read.
      // eslint-disable-next-line no-await-in-loop
      const rows = await api.query(
        `SELECT ${field} v, COUNT(Id) n FROM ${object} GROUP BY ${field}`
      );
      if (rows.length)
        counts[`${object}.${field}`] = Object.fromEntries(
          rows.map((r) => [r.v ?? "(blank)", r.n])
        );
    }
  });

  // Objects: every custom object, plus every standard object that has automation or code on it.
  const touches = {};
  out.components.forEach((c) => {
    if (c.object) touches[c.object] = (touches[c.object] ?? 0) + 1;
  });
  const wanted = [...catalog.values()]
    .filter(
      (o) =>
        (o.custom && o.name.endsWith("__c")) ||
        touches[o.name] ||
        KEY_OBJECTS.includes(o.name)
    )
    .map((o) => o.name);
  const recordCounts = {};
  await step("Counting records", async () => {
    for (let i = 0; i < wanted.length; i += COUNT_BATCH) {
      // eslint-disable-next-line no-await-in-loop -- small batches keep the URL short
      const rc = await api.get(
        `/services/data/${API}/limits/recordCount?sObjects=${wanted.slice(i, i + COUNT_BATCH).join(",")}`
      );
      (rc.sObjects ?? []).forEach((x) => {
        recordCounts[x.name] = x.count;
      });
    }
  });

  onProgress("Building the map of your org");
  const objects = wanted
    .map((name) => ({
      name,
      label: catalog.get(name)?.label ?? name,
      custom: name.endsWith("__c"),
      records: recordCounts[name] ?? null,
      fields: null,
      year: null,
      touchedBy: touches[name] ?? 0
    }))
    .sort(
      (a, b) => b.touchedBy - a.touchedBy || (b.records ?? 0) - (a.records ?? 0)
    );
  return {
    name: orgName,
    kind: "live",
    objects,
    components: out.components,
    counts,
    layering: layeringFor(out.components),
    stats
  };
}

/**
 * Year layers only tell a story when the org grew over several eras. A young org
 * (everything built in the last couple of years) is clearer layered by kind.
 */
function eraOf(year) {
  if (year >= 2024) return "recent";
  if (year >= 2021) return "mid";
  if (year >= 2018) return "older";
  return "oldest";
}

export function layeringFor(components) {
  const years = components.map((c) => c.year).filter(Boolean);
  return new Set(years.map(eraOf)).size >= 2 ? "year" : "kind";
}
