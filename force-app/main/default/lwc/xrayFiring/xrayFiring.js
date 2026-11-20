/**
 * "What fires when": the automation that runs when a record is saved, in Salesforce's
 * order of execution. Pure and deterministic: built only from components in the index,
 * so it never describes anything the org does not have.
 *
 * Reads the structured `fires` facts the readers attach:
 *   flow / processBuilder: { timing: 'before'|'after'|'beforeDelete', on: ['create','update','delete'], order }
 *   trigger:               { before: ['insert',...], after: ['update',...] }
 *   workflow:              { on: ['create'] | ['create','update'] }
 * Older indexes (demo, zip without `fires`) are understood from their text details.
 */

export const EVENTS = [
  { k: "create", label: "Created" },
  { k: "update", label: "Edited" },
  { k: "delete", label: "Deleted" }
];

const TRIGGER_EVENT = { create: "insert", update: "update", delete: "delete" };
const lower = (v) => String(v ?? "").toLowerCase();

/** Structured firing facts for a component, from `fires` or from its text details. */
export function firesOf(c) {
  if (c.fires) return c.fires;
  const d = c.detail ?? {};
  if (c.type === "trigger") {
    const events = (d.events ?? []).map(lower);
    const pick = (t) =>
      events.filter((e) => e.startsWith(t)).map((e) => e.split(/\s+/)[1]);
    return { before: pick("before"), after: pick("after") };
  }
  if (c.type === "flow" || c.type === "processBuilder") {
    const t = lower(d.trigger);
    if (!/record-triggered|after save|before save|before delete/.test(t))
      return c.type === "processBuilder"
        ? { timing: "after", on: ["create", "update"] }
        : null;
    let timing = "after";
    if (/before delete/.test(t)) timing = "beforeDelete";
    else if (/before save/.test(t)) timing = "before";
    let on = ["create", "update"];
    if (/\(create\)/.test(t)) on = ["create"];
    else if (/\(update\)/.test(t)) on = ["update"];
    if (timing === "beforeDelete" || /\(delete\)/.test(t)) on = ["delete"];
    return { timing, on, order: null };
  }
  if (c.type === "workflow") return { on: ["create", "update"] };
  if (c.type === "validation") return { on: ["create", "update"] };
  return null;
}

const byOrder = (a, b) =>
  (firesOf(a).order ?? 9999) - (firesOf(b).order ?? 9999) ||
  a.name.localeCompare(b.name);

function item(c, index, extra = {}) {
  const d = c.detail ?? {};
  const handlers = (d.handler ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  const calls = [
    ...handlers.map((h) => {
      const cls = index.components.find((x) => lower(x.name) === lower(h));
      return cls?.detail?.summary ? `${h}: ${cls.detail.summary}` : h;
    }),
    ...(d.actions ?? [])
  ];
  return {
    name: c.name,
    type: c.type,
    label: d.label && d.label !== c.name ? d.label : undefined,
    condition: d.entryCriteria || d.rule || undefined,
    message: d.message || undefined,
    calls: calls.length ? calls.slice(0, 8) : undefined,
    order: c.fires?.order ?? undefined,
    signals: d.signals,
    ...extra
  };
}

/**
 * @returns {{ object, event, phases: [{ k, title, note?, items: [] }], total, inactive, later: [] }}
 */
export function firingOrder(index, object, event = "update") {
  const ev = lower(event) === "insert" ? "create" : lower(event);
  const on = index.components.filter(
    (c) => lower(c.object) === lower(object) && firesOf(c)
  );
  const live = on.filter((c) => c.active !== false);
  const inactive = on.length - live.length;
  const flows = (timing) =>
    live
      .filter((c) => c.type === "flow" || c.type === "processBuilder")
      .filter((c) => {
        const f = firesOf(c);
        return f.timing === timing && (f.on ?? []).includes(ev);
      })
      .sort(byOrder);
  const triggers = (when) =>
    live
      .filter((c) => c.type === "trigger")
      .filter((c) => (firesOf(c)[when] ?? []).includes(TRIGGER_EVENT[ev]))
      .sort((a, b) => a.name.localeCompare(b.name));

  const phases = [];
  const add = (k, title, items, note) => {
    if (items.length)
      phases.push({ k, title, note, items: items.map((c) => item(c, index)) });
  };

  if (ev === "delete") {
    add("bflow", "Before-delete flows", flows("beforeDelete"));
    add("btrig", "Before-delete triggers", triggers("before"));
    add("atrig", "After-delete triggers", triggers("after"));
    add("aflow", "After-delete flows", flows("after"));
  } else {
    add(
      "bflow",
      "Before-save flows",
      flows("before"),
      "Fast field updates on the same record, before anything is saved."
    );
    add("btrig", "Before triggers", triggers("before"));
    add(
      "valid",
      "Validation rules",
      live.filter((c) => c.type === "validation"),
      "Any rule that matches blocks the save and shows its message."
    );
    add(
      "atrig",
      "After triggers",
      triggers("after"),
      "The record now has an Id; related records are usually created here."
    );
    const workflows = live.filter(
      (c) => c.type === "workflow" && (firesOf(c).on ?? []).includes(ev)
    );
    add(
      "wf",
      "Workflow rules",
      workflows,
      "A workflow field update saves the record again: before and after update triggers run one more time."
    );
    add(
      "aflow",
      "Processes and after-save flows",
      flows("after"),
      "Run in trigger order (when set), then by name."
    );
  }

  const later = live
    .filter(
      (c) =>
        (c.fires?.scheduled ?? []).length && (c.fires.on ?? []).includes(ev)
    )
    .map((c) => `${c.name}: ${c.fires.scheduled.join(", ")}`);
  return {
    object,
    event: ev,
    phases,
    total: phases.reduce((n, p) => n + p.items.length, 0),
    inactive,
    later
  };
}

/**
 * Lead conversion: the Lead is updated (IsConverted = true) and an Account, a Contact and
 * usually an Opportunity are created, so each of those runs its own save automation.
 */
export function leadConversion(index) {
  const has = (o) => index.objects.some((x) => lower(x.name) === lower(o));
  const parts = [
    { object: "Lead", event: "update", title: "Lead is marked converted" },
    {
      object: "Account",
      event: "create",
      title: "Account is created (or matched)"
    },
    {
      object: "Contact",
      event: "create",
      title: "Contact is created (or matched)"
    },
    {
      object: "Opportunity",
      event: "create",
      title: "Opportunity is created (optional)"
    }
  ]
    .filter(
      (p) =>
        p.object === "Lead" ||
        has(p.object) ||
        index.components.some((c) => lower(c.object) === lower(p.object))
    )
    .map((p) => ({ ...p, ...firingOrder(index, p.object, p.event) }));
  const code = index.components
    .filter((c) =>
      (c.detail?.signals ?? []).some((s) => /conver(t|sion)/i.test(s))
    )
    .map((c) => ({
      name: c.name,
      type: c.type,
      object: c.object,
      signals: c.detail.signals
    }));
  return {
    parts,
    code,
    note: 'Validation rules, workflow rules and processes on Lead only run during conversion if the org enables "Require Validation for Converted Leads". Triggers and flows always run.'
  };
}

/** Objects worth offering in a picker: the ones with save automation, busiest first. */
export function objectsWithAutomation(index) {
  const counts = {};
  index.components.forEach((c) => {
    if (c.object && c.active !== false && firesOf(c))
      counts[c.object] = (counts[c.object] ?? 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));
}

/** A compact text version, for the crew's journal and for chat answers. */
export function firingText(result, { max = 1800 } = {}) {
  if (!result.total)
    return `Nothing in this org runs automatically when a ${result.object} is ${result.event === "create" ? "created" : `${result.event}d`}.`;
  let n = 0;
  const lines = result.phases.map(
    (p) =>
      `${p.title}: ${p.items
        .map((i) => {
          n++;
          const extra = [
            i.condition && `when ${i.condition}`,
            i.calls && `→ ${i.calls.slice(0, 3).join("; ")}`
          ]
            .filter(Boolean)
            .join(" ");
          return `${n}. ${i.name}${extra ? ` (${extra})` : ""}`;
        })
        .join(" ")}`
  );
  if (result.later.length)
    lines.push(`Later (scheduled): ${result.later.join("; ")}`);
  const text = lines.join("\n");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
