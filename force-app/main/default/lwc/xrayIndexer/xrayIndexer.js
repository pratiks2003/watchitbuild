/**
 * Builds a metadata index (the same shape as c/xrayDemoOrg) from the files of a
 * Metadata API zip, entirely in the visitor's browser. Only metadata is read: no
 * records exist in the zip, so counts are unknown and the crew says so.
 *
 * Input: Map or object of { "unpackaged/flows/X.flow": "<xml…>" }.
 */

const MAX_COMPONENTS = 600;
const MAX_OBJECTS = 200;
const MAX_PERMSETS = 40;
const MAX_VALUES = 12;
const MAX_CLASS_CHARS = 200000;

/** Standard value sets and the picklist field they drive. */
const STANDARD_SETS = {
  OpportunityStage: ["Opportunity", "StageName"],
  CaseStatus: ["Case", "Status"],
  LeadStatus: ["Lead", "Status"],
  OrderStatus: ["Order", "Status"],
  QuoteStatus: ["Quote", "Status"],
  ContractStatus: ["Contract", "Status"],
  CasePriority: ["Case", "Priority"],
  OpportunityType: ["Opportunity", "Type"]
};

/** Keeps the most telling components when an org has more than we can show. */
const PRIORITY = {
  approval: 0,
  flow: 1,
  trigger: 2,
  validation: 3,
  path: 4,
  picklist: 5,
  batch: 6,
  namedCredential: 7,
  queue: 8,
  processBuilder: 9,
  workflow: 10,
  permset: 11,
  class: 12
};

/* ---------- small XML helpers (namespace-agnostic) ---------- */

function parse(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  return doc.getElementsByTagName("parsererror").length ? null : doc;
}

function children(el, name) {
  return el ? Array.from(el.children).filter((c) => c.localName === name) : [];
}
const child = (el, name) => children(el, name)[0] ?? null;
const text = (el, name) => child(el, name)?.textContent?.trim() ?? "";
function clip(s, n) {
  return s && s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

const fileName = (path) => path.split("/").pop();
const baseName = (path) => fileName(path).replace(/\.[^.]+$/, "");
const folderOf = (path) => path.split("/").slice(-2, -1)[0];

/* ---------- per metadata type ---------- */

function readObject(name, root, out) {
  const fields = children(root, "fields");
  out.objects.push({
    name,
    label: text(root, "label") || name,
    custom: /__c$|__mdt$|__e$/.test(name),
    records: null,
    fields: fields.length,
    year: null
  });
  fields.forEach((f) => {
    if (
      text(f, "type") !== "Picklist" &&
      text(f, "type") !== "MultiselectPicklist"
    )
      return;
    const values = children(
      child(child(f, "valueSet"), "valueSetDefinition"),
      "value"
    ).map((v) => text(v, "fullName"));
    if (values.length) {
      out.components.push({
        name: `${name}.${text(f, "fullName")}`,
        type: "picklist",
        object: name,
        year: null,
        active: true,
        detail: { values: values.slice(0, MAX_VALUES) }
      });
    }
  });
  children(root, "validationRules").forEach((v) => {
    out.components.push({
      name: text(v, "fullName"),
      type: "validation",
      object: name,
      year: null,
      active: text(v, "active") === "true",
      detail: {
        rule: clip(text(v, "errorConditionFormula"), 300),
        message: clip(text(v, "errorMessage"), 200)
      }
    });
  });
}

function readStandardValueSet(name, root, out) {
  const target = STANDARD_SETS[name];
  if (!target) return;
  const values = children(root, "standardValue").map((v) =>
    text(v, "fullName")
  );
  out.components.push({
    name: target.join("."),
    type: "picklist",
    object: target[0],
    year: null,
    active: true,
    detail: { values: values.slice(0, MAX_VALUES) }
  });
}

function readFlow(name, root, out) {
  const processType = text(root, "processType");
  const start = child(root, "start");
  const object = text(start, "object") || null;
  const filters = children(start, "filters").map((f) =>
    `${text(f, "field")} ${text(f, "operator")} ${child(f, "value")?.textContent?.trim() ?? ""}`.trim()
  );
  const actions = [
    ...children(root, "recordCreates").map(
      (r) => `Create ${text(r, "object") || "record"}`
    ),
    ...children(root, "recordUpdates").map(
      (r) =>
        `Update ${text(r, "object") || text(r, "inputReference") || "record"}`
    ),
    ...children(root, "recordDeletes").map(
      (r) => `Delete ${text(r, "object") || "record"}`
    ),
    ...children(root, "actionCalls").map(
      (a) => `${text(a, "actionType") || "Action"}: ${text(a, "actionName")}`
    ),
    ...children(root, "subflows").map((s) => `Subflow ${text(s, "flowName")}`)
  ];
  const triggerType = text(start, "triggerType");
  const when = {
    RecordAfterSave: "after save",
    RecordBeforeSave: "before save",
    RecordBeforeDelete: "before delete",
    Scheduled: "scheduled",
    PlatformEvent: "platform event"
  }[triggerType];
  out.components.push({
    name,
    type: processType === "Workflow" ? "processBuilder" : "flow",
    object,
    year: null,
    active: text(root, "status") === "Active",
    detail: {
      label: text(root, "label"),
      trigger: when
        ? `Record-triggered, ${when}${text(start, "recordTriggerType") ? ` (${text(start, "recordTriggerType")})` : ""}`
        : processType || "Flow",
      entryCriteria:
        clip(text(start, "filterFormula") || filters.join(" AND "), 300) ||
        undefined,
      actions: [...new Set(actions)].slice(0, 10)
    }
  });
}

function readTrigger(name, body, meta, out) {
  const m = /trigger\s+(\w+)\s+on\s+(\w+)\s*\(([^)]*)\)/i.exec(body);
  const calls = [...body.matchAll(/\b([A-Z]\w+)\.(\w+)\s*\(/g)]
    .map((x) => x[1])
    .filter(
      (n) =>
        ![
          "Trigger",
          "System",
          "Database",
          "Schema",
          "String",
          "Math",
          "Date",
          "Datetime"
        ].includes(n)
    );
  out.components.push({
    name,
    type: "trigger",
    object: m?.[2] ?? null,
    year: null,
    active: !meta || /<status>Active<\/status>/.test(meta),
    detail: {
      events: (m?.[3] ?? "")
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean),
      handler: [...new Set(calls)].slice(0, 3).join(", ") || undefined
    }
  });
}

function readClass(name, body, meta, objectNames, out) {
  if (/@isTest/i.test(body.slice(0, 2000))) return; // tests describe nothing about the business
  const src = body.slice(0, MAX_CLASS_CHARS);
  const kinds = [];
  if (/implements\s+[^{]*Database\.Batchable/i.test(src)) kinds.push("batch");
  if (/implements\s+[^{]*Schedulable/i.test(src)) kinds.push("schedulable");
  if (/implements\s+[^{]*Queueable/i.test(src)) kinds.push("queueable");
  if (/@RestResource/i.test(src)) kinds.push("REST endpoint");
  if (/@InvocableMethod/i.test(src)) kinds.push("invocable from flows");
  const callouts = [
    ...new Set([...src.matchAll(/callout:(\w+)/g)].map((x) => x[1]))
  ];
  const writes = [
    ...new Set(
      [...src.matchAll(/new\s+(\w+)\s*\(/g)]
        .map((x) => x[1])
        .filter((n) => objectNames.has(n))
    )
  ];
  const doc = /\/\*\*([\s\S]*?)\*\//
    .exec(src)?.[1]
    ?.replace(/\s*\*\s?/g, " ")
    .trim();
  out.components.push({
    name,
    type: kinds.includes("batch") ? "batch" : "class",
    object: writes.length === 1 ? writes[0] : null,
    year: null,
    active: !meta || !/<status>Deleted<\/status>/.test(meta),
    detail: {
      summary: clip(doc, 240) || undefined,
      kinds: kinds.length ? kinds : undefined,
      callout: callouts.length
        ? callouts.map((c) => `Named Credential ${c}`).join(", ")
        : undefined,
      writes: writes.length ? writes.slice(0, 6) : undefined,
      lines: src.split("\n").length
    }
  });
}

function readApproval(file, root, out) {
  const [object, ...rest] = baseName(file).split(".");
  const items = children(child(root, "entryCriteria"), "criteriaItems").map(
    (c) => `${text(c, "field")} ${text(c, "operation")} ${text(c, "value")}`
  );
  const formula = text(child(root, "entryCriteria"), "formula");
  const approvers = children(root, "approvalStep").flatMap((step) =>
    children(child(step, "assignedApprover"), "approver").map(
      (a) => `${text(a, "type")}: ${text(a, "name") || "manager"}`
    )
  );
  out.components.push({
    name: rest.join(".") || object,
    type: "approval",
    object,
    year: null,
    active: text(root, "active") === "true",
    detail: {
      label: text(root, "label"),
      entryCriteria: clip(formula || items.join(" AND "), 300) || undefined,
      approver: [...new Set(approvers)].join(", ") || undefined,
      steps: children(root, "approvalStep").length
    }
  });
}

function readNamedCredential(name, root, out) {
  out.components.push({
    name,
    type: "namedCredential",
    object: null,
    year: null,
    active: true,
    detail: {
      endpoint: text(root, "endpoint") || text(root, "url") || undefined,
      label: text(root, "label")
    }
  });
}

function readQueue(name, root, out) {
  const objects = children(root, "queueSobject").map((q) =>
    text(q, "sobjectType")
  );
  out.components.push({
    name,
    type: "queue",
    object: objects[0] ?? null,
    year: null,
    active: true,
    detail: { label: text(root, "name"), objects }
  });
}

function readPermset(name, root, out) {
  const edit = children(root, "objectPermissions")
    .filter((o) => text(o, "allowEdit") === "true")
    .map((o) => text(o, "object"));
  const fields = children(root, "fieldPermissions")
    .filter((f) => text(f, "editable") === "true")
    .map((f) => text(f, "field"));
  if (!edit.length && !fields.length) return;
  out.components.push({
    name,
    type: "permset",
    object: null,
    year: null,
    active: true,
    detail: {
      label: text(root, "label"),
      editObjects: edit.slice(0, 12),
      editFields: fields.slice(0, 10)
    }
  });
}

function readPath(name, root, out) {
  out.components.push({
    name,
    type: "path",
    object: text(root, "entityName") || null,
    year: null,
    active: text(root, "active") === "true",
    detail: {
      field: text(root, "fieldName"),
      recordType: text(root, "recordTypeName") || undefined
    }
  });
}

function readWorkflow(file, root, out) {
  const object = baseName(file);
  children(root, "rules").forEach((r) => {
    out.components.push({
      name: text(r, "fullName"),
      type: "workflow",
      object,
      year: null,
      active: text(r, "active") === "true",
      detail: { criteria: clip(text(r, "formula"), 200) || undefined }
    });
  });
}

/* ---------- entry point ---------- */

/**
 * @param {Object<string,string>|Map<string,string>} files path -> text
 * @param {{ name?: string }} options
 * @returns the index, plus `stats` describing what was read and what was skipped
 */
export function buildIndex(files, { name = "Your org" } = {}) {
  const entries =
    files instanceof Map ? [...files.entries()] : Object.entries(files);
  const byPath = new Map(entries);
  const out = { objects: [], components: [] };
  const stats = { files: entries.length, unreadable: 0, skippedComponents: 0 };

  // Objects first, so classes can recognise which object names they write to.
  const xmlOf = (path) => {
    const doc = parse(byPath.get(path));
    if (!doc) stats.unreadable++;
    return doc?.documentElement ?? null;
  };
  entries
    .filter(([p]) => folderOf(p) === "objects" && p.endsWith(".object"))
    .forEach(([p]) => {
      const root = xmlOf(p);
      if (root) readObject(baseName(p), root, out);
    });
  const objectNames = new Set(out.objects.map((o) => o.name));

  entries.forEach(([p, body]) => {
    const folder = folderOf(p);
    const meta = byPath.get(`${p}-meta.xml`);
    if (folder === "triggers" && p.endsWith(".trigger"))
      return readTrigger(baseName(p), body, meta, out);
    if (folder === "classes" && p.endsWith(".cls"))
      return readClass(baseName(p), body, meta, objectNames, out);
    const reader = {
      standardValueSets: (root) => readStandardValueSet(baseName(p), root, out),
      flows: (root) => readFlow(baseName(p), root, out),
      approvalProcesses: (root) => readApproval(p, root, out),
      namedCredentials: (root) => readNamedCredential(baseName(p), root, out),
      queues: (root) => readQueue(baseName(p), root, out),
      permissionsets: (root) => readPermset(baseName(p), root, out),
      pathAssistants: (root) => readPath(baseName(p), root, out),
      workflows: (root) => readWorkflow(p, root, out)
    }[folder];
    if (reader && !p.endsWith("-meta.xml")) {
      const root = xmlOf(p);
      if (root) reader(root);
    }
    return undefined;
  });

  // Keep the most telling components, and the objects they touch.
  let permsets = 0;
  const ranked = out.components
    .filter((c) => (c.type === "permset" ? permsets++ < MAX_PERMSETS : true))
    .sort(
      (a, b) =>
        (PRIORITY[a.type] ?? 99) - (PRIORITY[b.type] ?? 99) ||
        (b.active === a.active ? 0 : b.active ? 1 : -1)
    );
  const components = ranked.slice(0, MAX_COMPONENTS);
  stats.skippedComponents = out.components.length - components.length;
  const touches = {};
  components.forEach((c) => {
    if (c.object) touches[c.object] = (touches[c.object] ?? 0) + 1;
  });
  const objects = out.objects
    .map((o) => ({ ...o, components: touches[o.name] ?? 0 }))
    .sort((a, b) => b.components - a.components)
    .slice(0, MAX_OBJECTS)
    .map(({ components: n, ...o }) => ({ ...o, touchedBy: n }));

  return {
    name,
    kind: "upload",
    objects,
    components,
    counts: {},
    layering: "kind",
    stats
  };
}
