/* eslint-disable @lwc/lwc/no-async-operation -- the "play the process" token animation */
import { LightningElement, api } from "lwc";
import {
  LANES,
  PROCESS_NODES,
  PROCESS_CAPTIONS,
  PROCESS_BRANCH,
  PLAIN,
  STORY_ORDER,
  STORY_GAP,
  CARDS,
  LENS,
  NEW_HERE,
  ROLES
} from "c/xrayDemoData";
import { toSegments } from "c/xrayText";

const SVG = "http://www.w3.org/2000/svg";
const LANE_H = 66;
const TOP = 30;
const center = (n) => [n[1], TOP + n[0] * LANE_H + LANE_H / 2];
const listOf = (items, prefix) =>
  items.map((text, i) => ({
    key: `${prefix}${i}`,
    segments: toSegments(text)
  }));

/** The reconstructed business process: swimlane, plain-words story and "what this means for you". */
export default class XrayProcess extends LightningElement {
  @api visible = false;
  @api audience = "dev";
  @api newHere = false;
  @api found = [];

  captionText =
    "Press **Play the process** to follow one customer, Maya from Summit Lodge, through the whole business.";
  _drawn = false;
  _token = 0;

  renderedCallback() {
    if (this.visible && !this._drawn && this.refs.lane) {
      this.drawLane();
      this._drawn = true;
    }
  }

  disconnectedCallback() {
    this._token++;
  }

  get sectionCls() {
    return `panel lane${this.visible ? "" : " rolled"}`;
  }

  get ariaHidden() {
    return String(!this.visible);
  }

  get caption() {
    return toSegments(this.captionText);
  }

  get story() {
    const found = new Set(this.found ?? []);
    const have = STORY_ORDER.filter((id) => found.has(id)).map((id) => ({
      key: id,
      text: PLAIN[id],
      likely: CARDS[id].status === "likely",
      cls: "item"
    }));
    const missing = STORY_ORDER.filter((id) => !found.has(id)).map((id) => ({
      key: id,
      text: `Not found yet: ${STORY_GAP[id]}`,
      likely: false,
      cls: "item gap"
    }));
    return [...have, ...missing];
  }

  get lens() {
    const lens = LENS[this.audience] ?? LENS.dev;
    return {
      title: lens.title,
      chip: ROLES[this.audience]?.label ?? "",
      items: listOf(lens.items, "l")
    };
  }

  get cheatSheet() {
    const sheet = this.audience === "dev" ? NEW_HERE.tech : NEW_HERE.biz;
    return { title: sheet.title, items: listOf(sheet.items, "n") };
  }

  drawLane() {
    const host = this.refs.lane;
    host.textContent = "";
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 1440 470");
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      "Business process across six teams, from customer enquiry to refund."
    );
    const el = (tag, attrs, parent = svg, text) => {
      const node = document.createElementNS(SVG, tag);
      Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
      if (text !== undefined) node.textContent = text;
      parent.appendChild(node);
      return node;
    };
    LANES.forEach((name, i) => {
      el("rect", {
        x: 0,
        y: TOP + i * LANE_H,
        width: 1440,
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
    const main = PROCESS_NODES.slice(0, 8)
      .map((n, i) => `${i ? "L" : "M"}${center(n).join(",")}`)
      .join(" ");
    this._path = el("path", { d: main, class: "flow" });
    const [bx, by] = center(PROCESS_NODES[7]);
    const [rx, ry] = center(PROCESS_NODES[8]);
    el("path", { d: `M${bx},${by} L${rx},${ry}`, class: "flow branch" });
    PROCESS_NODES.forEach((n) => {
      const [x, y] = center(n);
      const g = el("g", { class: n[4] === "l" ? "node out" : "node" });
      el("rect", { x: x - 66, y: y - 24, width: 132, height: 48, rx: 6 }, g);
      el("text", { x, y: y - 3, "text-anchor": "middle" }, g, n[2]);
      el(
        "text",
        { x, y: y + 13, "text-anchor": "middle", class: "ev" },
        g,
        n[3]
      );
      el(
        "circle",
        {
          cx: x + 58,
          cy: y - 16,
          r: 5,
          class: n[4] === "c" ? "dot ok" : "dot likely"
        },
        g
      );
    });
    el(
      "text",
      { x: 1170, y: 20, class: "legend" },
      svg,
      "green = confirmed · yellow = likely"
    );
    this._tokenG = el("g", { class: "token", opacity: 0 });
    el("circle", { r: 12 }, this._tokenG);
    el("text", { x: 0, y: -18, "text-anchor": "middle" }, this._tokenG, "MAYA");
    host.appendChild(svg);
  }

  async handlePlay() {
    if (!this._path) return;
    const my = ++this._token;
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const path = this._path;
    const length = path.getTotalLength();
    const stops = PROCESS_NODES.slice(0, 8).map((n) => {
      const [x, y] = center(n);
      let best = 0;
      let bestD = Infinity;
      for (let s = 0; s <= length; s += 4) {
        const p = path.getPointAtLength(s);
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bestD) {
          bestD = d;
          best = s;
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
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        const start = performance.now();
        const step = (now) => {
          if (my !== this._token) return;
          const k = duration ? Math.min(1, (now - start) / duration) : 1;
          const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
          const p = path.getPointAtLength(from + (to - from) * e);
          this._tokenG.setAttribute("transform", `translate(${p.x},${p.y})`);
          if (k < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
      if (my !== this._token) return;
      pos = to;
      this.captionText = `**Step ${i + 1}.** ${PROCESS_CAPTIONS[i]}`;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, reduce ? 0 : 1900));
      if (my !== this._token) return;
    }
    this.captionText = PROCESS_BRANCH;
    const [x, y] = center(PROCESS_NODES[8]);
    this._tokenG.setAttribute("transform", `translate(${x},${y})`);
  }
}
