/**
 * Live connect: the visitor signs in to their own org and their browser reads its
 * metadata directly. OAuth 2.0 authorization code + PKCE with a public client (no
 * secret). The code is exchanged at the visitor's own My Domain, so the access token
 * never touches our server; it lives in this tab's memory only.
 *
 * Visitor-org setup (their admin, once): add this site's origin to Setup > CORS, and
 * tick "Enable CORS for OAuth endpoints".
 */
import { readTrigger, readClass } from "c/xrayIndexer";

/** Public client ID of the "Org X-Ray" connected app (not a secret: PKCE public client). */
export const CLIENT_ID =
  "3MVG91oqviqJKoEFkOuhB_Rqa.Hj5fNuMLOc6Fw1TqogHGA2Xb_EexU5kkuCGJtgqRjICnbo4fYwKYJncOQD3";
const API = "v68.0";
const PENDING_KEY = "orgxray.oauth";
const MAX_FLOW_DETAILS = 40;
const MAX_COMPONENTS = 600;
const MAX_OBJECTS = 200;
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
  const query = async (soql, tooling = false, maxPages = 3) => {
    let page = await get(
      `/services/data/${API}/${tooling ? "tooling/" : ""}query?q=${encodeURIComponent(soql)}`
    );
    const records = [...page.records];
    for (let i = 1; i < maxPages && page.nextRecordsUrl; i++) {
      // eslint-disable-next-line no-await-in-loop -- pages must be fetched in order
      page = await get(page.nextRecordsUrl);
      records.push(...page.records);
    }
    return records;
  };
  return { get, query };
}

const yearOf = (iso) => (iso ? Number(String(iso).slice(0, 4)) : null);

/**
 * Reads metadata (and aggregate counts only, never records) through the visitor's token,
 * and returns an index in the same shape as c/xrayDemoOrg. Each part is optional: if the
 * user lacks access to something, it is noted in stats and the rest still works.
 */
export async function readOrg(
  session,
  { onProgress = () => {}, fetchImpl } = {}
) {
  const api = apiClient(session, fetchImpl);
  const out = { objects: [], components: [] };
  const counts = {};
  const stats = { skipped: [] };
  const step = async (label, fn) => {
    onProgress(label);
    try {
      await fn();
    } catch (error) {
      stats.skipped.push(`${label}: ${error.message}`);
    }
  };

  let orgName = "Your org";
  await step("Reading the org name", async () => {
    orgName =
      (await api.query("SELECT Name FROM Organization"))[0]?.Name ?? orgName;
  });

  await step("Listing objects", async () => {
    const global = await api.get(`/services/data/${API}/sobjects`);
    const custom = global.sobjects
      .filter((o) => o.custom && o.name.endsWith("__c") && o.queryable)
      .map((o) => o.name);
    const standard = global.sobjects
      .filter((o) => KEY_OBJECTS.includes(o.name))
      .map((o) => o.name);
    const names = [...standard, ...custom].slice(0, 150);
    const labels = Object.fromEntries(
      global.sobjects.map((o) => [o.name, o.label])
    );
    let recordCounts = {};
    try {
      const rc = await api.get(
        `/services/data/${API}/limits/recordCount?sObjects=${names.join(",")}`
      );
      recordCounts = Object.fromEntries(
        (rc.sObjects ?? []).map((s) => [s.name, s.count])
      );
    } catch {
      // counts are a bonus; objects still work without them
    }
    names.forEach((name) => {
      out.objects.push({
        name,
        label: labels[name] ?? name,
        custom: name.endsWith("__c"),
        records: recordCounts[name] ?? null,
        fields: null,
        year: null
      });
    });
  });

  await step("Reading flows", async () => {
    const flows = await api.query(
      "SELECT Id, Definition.DeveloperName, ProcessType, Status, CreatedDate FROM Flow WHERE Status = 'Active' AND Definition.NamespacePrefix = null",
      true
    );
    // The browser caps parallel requests per host, so this stays polite.
    const metas = await Promise.all(
      flows.slice(0, MAX_FLOW_DETAILS).map((f) =>
        api
          .query(`SELECT Metadata FROM Flow WHERE Id = '${f.Id}'`, true)
          .then((rows) => rows[0]?.Metadata ?? null)
          .catch(() => null)
      )
    );
    for (const [i, f] of flows.entries()) {
      const meta = metas[i] ?? null;
      const start = meta?.start ?? {};
      const when = {
        RecordAfterSave: "after save",
        RecordBeforeSave: "before save",
        RecordBeforeDelete: "before delete",
        Scheduled: "scheduled",
        PlatformEvent: "platform event"
      }[start.triggerType];
      const actions = [
        ...(meta?.recordCreates ?? []).map(
          (r) => `Create ${r.object ?? "record"}`
        ),
        ...(meta?.recordUpdates ?? []).map(
          (r) => `Update ${r.object ?? r.inputReference ?? "record"}`
        ),
        ...(meta?.actionCalls ?? []).map(
          (a) => `${a.actionType ?? "Action"}: ${a.actionName}`
        )
      ];
      out.components.push({
        name: f.Definition?.DeveloperName ?? f.Id,
        type: f.ProcessType === "Workflow" ? "processBuilder" : "flow",
        object: start.object ?? null,
        year: yearOf(f.CreatedDate),
        active: true,
        detail: {
          label: meta?.label,
          trigger: when
            ? `Record-triggered, ${when}${start.recordTriggerType ? ` (${start.recordTriggerType})` : ""}`
            : f.ProcessType,
          entryCriteria:
            start.filterFormula ??
            ((start.filters ?? [])
              .map(
                (x) =>
                  `${x.field} ${x.operator} ${Object.values(x.value ?? {}).find((v) => v != null) ?? ""}`
              )
              .join(" AND ") ||
              undefined),
          actions: [...new Set(actions)].slice(0, 10)
        }
      });
    }
  });

  await step("Reading triggers", async () => {
    const triggers = await api.query(
      "SELECT Name, Status, CreatedDate, Body FROM ApexTrigger WHERE NamespacePrefix = null LIMIT 200",
      true
    );
    triggers.forEach((t) => {
      readTrigger(t.Name, t.Body ?? "", `<status>${t.Status}</status>`, out);
      out.components[out.components.length - 1].year = yearOf(t.CreatedDate);
    });
  });

  await step("Reading Apex classes", async () => {
    const objectNames = new Set(out.objects.map((o) => o.name));
    const classes = await api.query(
      "SELECT Name, Status, CreatedDate, Body FROM ApexClass WHERE NamespacePrefix = null LIMIT 300",
      true
    );
    classes.forEach((c) => {
      const before = out.components.length;
      readClass(
        c.Name,
        c.Body ?? "",
        `<status>${c.Status}</status>`,
        objectNames,
        out
      );
      if (out.components.length > before)
        out.components[out.components.length - 1].year = yearOf(c.CreatedDate);
    });
  });

  await step("Reading validation rules", async () => {
    const rules = await api.query(
      "SELECT ValidationName, Active, ErrorMessage, CreatedDate, EntityDefinition.QualifiedApiName FROM ValidationRule WHERE NamespacePrefix = null",
      true
    );
    rules.forEach((r) => {
      out.components.push({
        name: r.ValidationName,
        type: "validation",
        object: r.EntityDefinition?.QualifiedApiName ?? null,
        year: yearOf(r.CreatedDate),
        active: r.Active,
        detail: { message: r.ErrorMessage }
      });
    });
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
    for (const [object, field] of [
      ["Opportunity", "StageName"],
      ["Case", "Status"],
      ["Lead", "Status"]
    ]) {
      if (!out.objects.some((o) => o.name === object)) continue;
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
          detail: { values: values.slice(0, 12) }
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

  onProgress("Building the map of your org");
  const touches = {};
  out.components.forEach((c) => {
    if (c.object) touches[c.object] = (touches[c.object] ?? 0) + 1;
  });
  const objects = out.objects
    .map((o) => ({ ...o, touchedBy: touches[o.name] ?? 0 }))
    .sort(
      (a, b) => b.touchedBy - a.touchedBy || (b.records ?? 0) - (a.records ?? 0)
    )
    .slice(0, MAX_OBJECTS);
  return {
    name: orgName,
    kind: "live",
    objects,
    components: out.components.slice(0, MAX_COMPONENTS),
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
