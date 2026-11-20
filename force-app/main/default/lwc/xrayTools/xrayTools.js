/**
 * The crew's read-only tools. They run in the visitor's browser over a metadata index,
 * so nothing from the visitor's org is sent anywhere except the slice the crew is reading.
 * Every result is small and clipped, and records are never exposed: counts only.
 */

import { firingOrder, leadConversion, firingText } from "c/xrayFiring";

const MAX_RESULT_CHARS = 6000;
const SUMMARY_OBJECTS = 40;
const MAX_LIST = 25;
const MAX_SEARCH = 10;

export const TOOL_NAMES = [
  "listObjects",
  "describeObject",
  "listComponents",
  "getComponent",
  "countBy",
  "searchMetadata",
  "firingOrder"
];

const lower = (value) => String(value ?? "").toLowerCase();
const brief = (c) => ({
  name: c.name,
  type: c.type,
  object: c.object,
  year: c.year,
  active: c.active
});

function clip(result) {
  const text = JSON.stringify(result);
  return text.length <= MAX_RESULT_CHARS
    ? result
    : { clipped: true, text: `${text.slice(0, MAX_RESULT_CHARS)} …` };
}

/** One-paragraph overview the crew always sees. */
export function orgSummary(index) {
  // Big orgs have thousands of objects: name the busiest, count the rest.
  const ranked = [...index.objects].sort(
    (a, b) =>
      (b.touchedBy ?? 0) - (a.touchedBy ?? 0) ||
      (b.records ?? 0) - (a.records ?? 0)
  );
  const more = ranked.length - SUMMARY_OBJECTS;
  const objects =
    ranked
      .slice(0, SUMMARY_OBJECTS)
      .map(
        (o) => `${o.name}${o.records != null ? ` (${o.records} records)` : ""}`
      )
      .join(", ") + (more > 0 ? `, and ${more} more objects` : "");
  const types = {};
  index.components.forEach((c) => {
    types[c.type] = (types[c.type] ?? 0) + 1;
  });
  const kinds = Object.entries(types)
    .map(([type, n]) => `${n} ${type}`)
    .join(", ");
  return `Org: ${index.name}. Objects: ${objects}. Components: ${kinds}.`;
}

const TOOLS = {
  listObjects(index) {
    return index.objects.map((o) => ({
      name: o.name,
      label: o.label,
      custom: o.custom,
      records: o.records,
      fields: o.fields
    }));
  },

  describeObject(index, { name }) {
    const object = index.objects.find((o) => lower(o.name) === lower(name));
    if (!object) return { error: `No object named ${name}.` };
    const touching = index.components
      .filter((c) => lower(c.object) === lower(object.name))
      .map(brief);
    const countable = Object.keys(index.counts ?? {}).filter((k) =>
      k.startsWith(`${object.name}.`)
    );
    return {
      ...object,
      components: touching.slice(0, MAX_LIST),
      countableFields: countable
    };
  },

  listComponents(index, { type, object } = {}) {
    const matches = index.components.filter(
      (c) =>
        (!type || lower(c.type) === lower(type)) &&
        (!object || lower(c.object) === lower(object))
    );
    return {
      total: matches.length,
      items: matches.slice(0, MAX_LIST).map(brief)
    };
  },

  getComponent(index, { name }) {
    const component = index.components.find(
      (c) => lower(c.name) === lower(name)
    );
    return component ?? { error: `No component named ${name}.` };
  },

  countBy(index, { object, field }) {
    const counts = index.counts?.[`${object}.${field}`];
    return counts
      ? {
          object,
          field,
          counts,
          note: "Aggregate counts only. No records were read."
        }
      : { error: `No counts available for ${object}.${field}.` };
  },

  /** What runs, in order, when a record is created, edited or deleted. event "convert" = lead conversion. */
  firingOrder(index, { object, event = "update" }) {
    if (/conver(t|sion)/i.test(event) || /conver(t|sion)/i.test(object)) {
      const lc = leadConversion(index);
      return {
        leadConversion: lc.parts.map((p) => ({
          step: p.title,
          runs: firingText(p, { max: 900 })
        })),
        codeThatConverts: lc.code.slice(0, 15),
        note: lc.note
      };
    }
    const known = index.objects.find((o) => lower(o.name) === lower(object));
    const name = known?.name ?? object;
    const result = firingOrder(index, name, event);
    return {
      object: name,
      event: result.event,
      total: result.total,
      inactiveNotShown: result.inactive,
      order: firingText(result, { max: 4000 })
    };
  },

  searchMetadata(index, { text }) {
    const needle = lower(text).trim();
    if (needle.length < 2) return { error: "Search text is too short." };
    const hits = index.components.filter((c) =>
      lower(JSON.stringify(c)).includes(needle)
    );
    return { total: hits.length, items: hits.slice(0, MAX_SEARCH).map(brief) };
  }
};

/**
 * Runs one tool. Unknown tools return an error result rather than throwing, so a bad
 * step never breaks the investigation.
 */
export function runTool(index, tool, args = {}) {
  const fn = TOOLS[tool];
  if (!fn) return { error: `Unknown tool ${tool}.` };
  try {
    return clip(fn(index, args ?? {}));
  } catch (error) {
    return { error: `Tool ${tool} failed: ${error?.message ?? error}` };
  }
}

/** The component a step's action points at, if any (used to place the dig in 3D). */
export function targetOf(index, action) {
  if (!action) return null;
  const name = action.args?.name;
  if (action.tool === "getComponent" && name) {
    return index.components.find((c) => lower(c.name) === lower(name)) ?? null;
  }
  return null;
}

/** One line (max 220 chars) describing what a tool returned, for the crew's journal. */
export function resultLine(tool, result) {
  if (!result) return "";
  if (result.error) return `error: ${result.error}`.slice(0, 220);
  const names = (items) => (items ?? []).map((i) => i.name).join(", ");
  let line;
  switch (tool) {
    case "listObjects":
      line = `${result.length} objects: ${result.map((o) => `${o.name}${o.records != null ? ` ${o.records}` : ""}`).join(", ")}`;
      break;
    case "describeObject":
      line = `${result.name}: ${result.records ?? "?"} records, ${result.fields ?? "?"} fields; components: ${names(result.components)}; countable: ${(result.countableFields ?? []).join(", ")}`;
      break;
    case "listComponents":
    case "searchMetadata":
      line = `${result.total} found: ${names(result.items)}`;
      break;
    case "getComponent":
      line = `${result.type} ${result.name} on ${result.object ?? "-"} (${result.year}, ${result.active ? "active" : "inactive"}): ${JSON.stringify(result.detail ?? {})}`;
      break;
    case "firingOrder":
      line = result.leadConversion
        ? `lead conversion: ${result.leadConversion.map((p) => `${p.step}: ${p.runs}`).join(" | ")}`
        : `${result.object} ${result.event}: ${result.total} run in order: ${result.order}`;
      break;
    case "countBy":
      line = `${result.object}.${result.field}: ${JSON.stringify(result.counts)}`;
      break;
    default:
      line = JSON.stringify(result);
  }
  return line.length > 220 ? `${line.slice(0, 219)}…` : line;
}
