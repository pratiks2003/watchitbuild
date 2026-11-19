/**
 * Turns any org's metadata index into the dig site's layout: which year layer each
 * component is buried in, which column, and which objects get survey flags.
 * Pure and deterministic: the same index always produces the same dig site.
 */

/** Voxel rows per layer, top (today) to bottom (oldest). Floors are where the crew stands. */
const BANDS = [
  {
    k: "now",
    rows: [0, 1],
    color: "#c79d68",
    label: "Today",
    from: 9999,
    to: 9999
  },
  {
    k: "recent",
    rows: [2, 3],
    color: "#b3844f",
    label: "2024 and later",
    from: 2024,
    to: 9998,
    floor: -4
  },
  {
    k: "mid",
    rows: [4, 5],
    color: "#996a3c",
    label: "2021 to 2023",
    from: 2021,
    to: 2023,
    floor: -6
  },
  {
    k: "older",
    rows: [6, 7],
    color: "#7d5532",
    label: "2018 to 2020",
    from: 2018,
    to: 2020,
    floor: -8
  },
  {
    k: "oldest",
    rows: [8, 9],
    color: "#5e3f26",
    label: "Before 2018",
    from: 0,
    to: 2017,
    floor: -10
  }
];

/** Columns the components may use (0..23), skipping the shaft (4) and its neighbours. */
const COLUMNS = [
  1, 2, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22
];
const MAX_FLAGS = 8;
const FLAG_X = [-10.5, -8.4, -6.3, -4.2, -2.1, 0, 2.1, 4.2];

export const ICONS = {
  flow: "⟳",
  processBuilder: "⟳",
  workflow: "⚑",
  trigger: "⚡",
  class: "{ }",
  batch: "⇄",
  approval: "✓",
  validation: "!",
  picklist: "≡",
  path: "→",
  namedCredential: "⇄",
  queue: "☰",
  permset: "🔑",
  vfpage: "▢"
};

/** Layering by kind (for uploads without dates). */
const KIND_BAND = {
  flow: "recent",
  processBuilder: "recent",
  workflow: "recent",
  trigger: "recent",
  approval: "mid",
  validation: "mid",
  path: "mid",
  picklist: "mid",
  class: "older",
  batch: "older",
  vfpage: "older",
  queue: "oldest",
  permset: "oldest",
  namedCredential: "oldest"
};
const KIND_LABELS = {
  now: "Objects",
  recent: "Automation",
  mid: "Rules and steps",
  older: "Code",
  oldest: "Access and integration"
};

const bandOf = (year) =>
  BANDS.slice(1).find((b) => (year ?? 0) >= b.from && (year ?? 0) <= b.to) ??
  BANDS[4];

/** A stable small hash, so placement does not depend on array order. */
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * @returns {{ layers, artifacts: Object<string, {name,type,layer,c,icon,title,decoy}>, flags: [string, number][], totals }}
 */
export function buildLayout(index) {
  // Uploaded metadata has no build dates: layer by kind instead of pretending to know the year.
  const byKind =
    index.layering === "kind" || !index.components.some((c) => c.year);
  const layers = BANDS.map((b) => ({
    ...b,
    label: byKind ? (KIND_LABELS[b.k] ?? b.label) : b.label,
    count: 0
  }));
  const byLayer = Object.fromEntries(BANDS.map((b) => [b.k, []]));
  index.components.forEach((component) => {
    const band = byKind
      ? (BANDS.find((b) => b.k === (KIND_BAND[component.type] ?? "older")) ??
        BANDS[3])
      : bandOf(component.year);
    layers.find((l) => l.k === band.k).count++;
    byLayer[band.k].push(component);
  });
  layers[0].count = index.objects.length;

  const artifacts = {};
  Object.entries(byLayer).forEach(([k, components]) => {
    const used = new Set();
    [...components]
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((component) => {
        // Prefer a hashed column; walk to the next free one. If a layer is full, the rest stay unplaced
        // (they are still in the index and on the board, just not drawn as a buried block).
        const start = hash(component.name) % COLUMNS.length;
        for (let i = 0; i < COLUMNS.length; i++) {
          const c = COLUMNS[(start + i) % COLUMNS.length];
          if (!used.has(c)) {
            used.add(c);
            artifacts[component.name] = {
              name: component.name,
              type: component.type,
              layer: k,
              c,
              icon: ICONS[component.type] ?? "◆",
              title: component.name,
              decoy: component.active === false
            };
            break;
          }
        }
      });
  });

  const flags = [...index.objects]
    .sort(
      (a, b) =>
        (b.records ?? b.touchedBy ?? 0) - (a.records ?? a.touchedBy ?? 0)
    )
    .slice(0, MAX_FLAGS)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((o, i) => [o.name, FLAG_X[i]]);

  return {
    byKind,
    layers,
    artifacts,
    flags,
    totals: {
      objects: index.objects.length,
      components: index.components.length
    }
  };
}
