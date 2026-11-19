/* eslint-disable @lwc/lwc/no-async-operation -- the "play the process" token animation */
import { LightningElement, api } from "lwc";
import { ROLES } from "c/xrayDemoData";
import { toSegments } from "c/xrayText";

const SVG = "http://www.w3.org/2000/svg";
const LANE_H = 66;
const TOP = 30;
const LEFT = 170;
const STEP_W = 150;
const listOf = (items, prefix) =>
  (items ?? []).map((text, i) => ({
    key: `${prefix}${i}`,
    segments: toSegments(text)
  }));

const LENS_TITLES = {
  dev: "Where the logic lives",
  po: "What a product owner should look at",
  user: "What happens when you…"
};

/** The reconstructed business process from Ada's summary: swimlane, plain story, role lens. */
export default class XrayProcess extends LightningElement {
  @api visible = false;
  @api audience = "dev";
  @api newHere = false;

  captionText =
    "Press **Play the process** to follow one customer through the whole business.";
  _summary = null;
  _drawnFor = null;
  _token = 0;

  /** { process: { lanes, steps }, story, lens: { dev, po, user }, newHere: { tech, biz } } */
  @api
  get summary() {
    return this._summary;
  }
  set summary(value) {
    this._summary = value;
    this._token++;
    this.captionText =
      "Press **Play the process** to follow one customer through the whole business.";
  }

  renderedCallback() {
    if (
      this.visible &&
      this.hasProcess &&
      this._drawnFor !== this._summary &&
      this.refs.lane
    ) {
      this.drawLane();
      this._drawnFor = this._summary;
    }
  }

  disconnectedCallback() {
    this._token++;
  }

  get hasProcess() {
    return (this._summary?.process?.steps?.length ?? 0) >= 2;
  }

  get sectionCls() {
    return `panel lane${this.visible ? "" : " rolled"}`;
  }

  get ariaHidden() {
    return String(!this.visible);
  }

  get stats() {
    const steps = this._summary?.process?.steps ?? [];
    const n = (c) => steps.filter((s) => s.confidence === c).length;
    const outside = steps.filter((s) => s.outside).length;
    return `${steps.length} steps · ${this._summary?.process?.lanes?.length ?? 0} teams · ${n("confirmed")} confirmed · ${n("likely")} likely${outside ? ` · ${outside} outside Salesforce` : ""}`;
  }

  get caption() {
    return toSegments(this.captionText);
  }

  get story() {
    return (this._summary?.story ?? []).map((text, i) => ({
      key: `s${i}`,
      text
    }));
  }

  get lens() {
    return {
      title: LENS_TITLES[this.audience] ?? LENS_TITLES.dev,
      chip: ROLES[this.audience]?.label ?? "",
      items: listOf(this._summary?.lens?.[this.audience], "l")
    };
  }

  get cheatSheet() {
    const tech = this.audience === "dev";
    return {
      title: tech
        ? "New developer cheat sheet"
        : "Your first-week business steps",
      items: listOf(
        tech ? this._summary?.newHere?.tech : this._summary?.newHere?.biz,
        "n"
      )
    };
  }

  center(step, i) {
    return [LEFT + 60 + i * STEP_W, TOP + step.lane * LANE_H + LANE_H / 2];
  }

  drawLane() {
    const host = this.refs.lane;
    const { lanes, steps } = this._summary.process;
    const width = Math.max(980, LEFT + 120 + steps.length * STEP_W);
    host.textContent = "";
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute(
      "viewBox",
      `0 0 ${width} ${TOP + lanes.length * LANE_H + 10}`
    );
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      `Business process across ${lanes.length} teams in ${steps.length} steps.`
    );
    svg.style.minWidth = `${Math.min(width, 1600)}px`;
    const el = (tag, attrs, parent = svg, text) => {
      const node = document.createElementNS(SVG, tag);
      Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
      if (text !== undefined) node.textContent = text;
      parent.appendChild(node);
      return node;
    };
    lanes.forEach((name, i) => {
      el("rect", {
        x: 0,
        y: TOP + i * LANE_H,
        width,
        height: LANE_H,
        class: i % 2 ? "lnbg alt" : "lnbg"
      });
      el(
        "text",
        { x: 14, y: TOP + i * LANE_H + LANE_H / 2 + 4, class: "lnlabel" },
        svg,
        name.toUpperCase()
      );
    });
    const path = steps
      .map((s, i) => `${i ? "L" : "M"}${this.center(s, i).join(",")}`)
      .join(" ");
    this._path = el("path", { d: path, class: "flow" });
    steps.forEach((s, i) => {
      const [x, y] = this.center(s, i);
      const g = el("g", { class: s.outside ? "node out" : "node" });
      el("rect", { x: x - 66, y: y - 24, width: 132, height: 48, rx: 6 }, g);
      el("text", { x, y: y - 3, "text-anchor": "middle" }, g, s.label);
      el(
        "text",
        { x, y: y + 13, "text-anchor": "middle", class: "ev" },
        g,
        s.evidence
      );
      el(
        "circle",
        {
          cx: x + 58,
          cy: y - 16,
          r: 5,
          class: s.confidence === "confirmed" ? "dot ok" : "dot likely"
        },
        g
      );
    });
    el(
      "text",
      { x: width - 270, y: 20, class: "legend" },
      svg,
      "green = confirmed · yellow = likely"
    );
    this._tokenG = el("g", { class: "token", opacity: 0 });
    el("circle", { r: 12 }, this._tokenG);
    el(
      "text",
      { x: 0, y: -18, "text-anchor": "middle" },
      this._tokenG,
      "CUSTOMER"
    );
    host.appendChild(svg);
  }

  async handlePlay() {
    if (!this._path || !this.hasProcess) return;
    const my = ++this._token;
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const steps = this._summary.process.steps;
    const path = this._path;
    const length = path.getTotalLength();
    const stops = steps.map((s, i) => {
      const [x, y] = this.center(s, i);
      let best = 0;
      let bestD = Infinity;
      for (let d = 0; d <= length; d += 4) {
        const p = path.getPointAtLength(d);
        const dist = Math.hypot(p.x - x, p.y - y);
        if (dist < bestD) {
          bestD = dist;
          best = d;
        }
      }
      return best;
    });
    this._tokenG.setAttribute("opacity", 1);
    let pos = 0;
    for (let i = 0; i < stops.length; i++) {
      const from = pos;
      const to = stops[i];
      const duration = reduce ? 0 : Math.max(300, (to - from) * 4);
      // eslint-disable-next-line no-await-in-loop -- the token moves step by step
      await new Promise((resolve) => {
        const start = performance.now();
        const tick = (now) => {
          if (my !== this._token) return;
          const k = duration ? Math.min(1, (now - start) / duration) : 1;
          const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
          const p = path.getPointAtLength(from + (to - from) * e);
          this._tokenG.setAttribute("transform", `translate(${p.x},${p.y})`);
          if (k < 1) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      if (my !== this._token) return;
      pos = to;
      const s = steps[i];
      this.captionText = `**Step ${i + 1} · ${this._summary.process.lanes[s.lane]}.** ${s.label}${s.evidence ? ` (${s.evidence})` : ""}${s.outside ? " · outside Salesforce" : ""}`;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, reduce ? 0 : 1900));
      if (my !== this._token) return;
    }
    this.captionText =
      "**That's the whole journey.** Click any crew member to ask about a step.";
  }
}
