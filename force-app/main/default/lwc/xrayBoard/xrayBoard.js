import { LightningElement, api } from "lwc";
import { GROUPS, AGENTS } from "c/xrayDemoData";

const SVG = "http://www.w3.org/2000/svg";
const COLS = 3;
const ROW_PX = 196;
const COL_X = [2, 36, 70];
const TILT = [-2, 1.5, -1, 1, -1.5, 2, -2, 1.5, -1];
const GROUP_LABEL = Object.fromEntries(GROUPS.map((g) => [g.id, g.label]));

/**
 * The cork evidence board. Pinned layout (with red string following the crew's trail)
 * for normal orgs; grouped by business stage for big ones.
 */
export default class XrayBoard extends LightningElement {
  /** @type {{finding: object, agent: string, instant: boolean}[]} in discovery order */
  @api findings = [];
  @api grouped = false;

  filter = "";
  _drawn = new Set();

  connectedCallback() {
    this._resize = new ResizeObserver(() => this.drawStrings());
  }

  renderedCallback() {
    if (this.refs.board && !this._observing) {
      this._resize.observe(this.refs.board);
      this._observing = true;
    }
    this.drawStrings();
  }

  disconnectedCallback() {
    this._resize?.disconnect();
  }

  get views() {
    const q = this.filter.trim().toLowerCase();
    return this.findings.map(({ finding: f, agent, instant }, i) => {
      const hidden =
        Boolean(q) &&
        !`${f.title} ${f.evidence} ${f.source} ${f.plain}`
          .toLowerCase()
          .includes(q);
      const who = AGENTS[agent]?.name ?? "the crew";
      return {
        id: f.id,
        group: GROUP_LABEL[f.group] ? f.group : "other",
        type: `${(GROUP_LABEL[f.group] ?? "Other").toUpperCase()} · ${who.toUpperCase()}`,
        title: f.title,
        evidence: f.evidence,
        source: f.source,
        hasSource: Boolean(f.source),
        ask: `ask ${who} →`,
        status: f.confidence.toUpperCase(),
        statusCls: `st ${f.confidence}`,
        cls: `card${instant ? "" : " pin"}${hidden ? " hide" : ""}`,
        style: this.grouped
          ? ""
          : `left:${COL_X[i % COLS]}%;top:${12 + Math.floor(i / COLS) * ROW_PX}px;--r:${TILT[i % TILT.length]}deg`,
        label: `${f.title}. ${f.evidence}. ${f.confidence}. Ask ${who} about it.`,
        agent
      };
    });
  }

  get columns() {
    const views = this.views;
    return GROUPS.map((g) => {
      const cards = views.filter((v) => v.group === g.id);
      return { ...g, cards, count: cards.length };
    }).filter((c) => c.count > 0);
  }

  get boardCls() {
    return `board${this.grouped ? " grouped" : ""}${this.findings.length ? " has" : ""}`;
  }

  get boardStyle() {
    if (this.grouped) return "";
    const rows = Math.max(3, Math.ceil(this.findings.length / COLS));
    return `height:${rows * ROW_PX + 24}px`;
  }

  get countText() {
    const n = this.findings.length;
    return `${n} ${n === 1 ? "card" : "cards"}`;
  }

  handleFilter(event) {
    this.filter = event.target.value;
  }

  handleAsk(event) {
    const id = event.currentTarget.dataset.id;
    const entry = this.findings.find((e) => e.finding.id === id);
    if (!entry) return;
    this.dispatchEvent(
      new CustomEvent("ask", {
        detail: {
          agent: entry.agent,
          findingId: id,
          title: entry.finding.title
        }
      })
    );
  }

  handleKey(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.handleAsk(event);
    }
  }

  /** Red string between consecutive findings: the trail the crew followed. Hidden when grouped or on phones. */
  drawStrings() {
    const host = this.refs.strings;
    const board = this.refs.board;
    if (!host || !board) return;
    host.textContent = "";
    if (!this.findings.length) this._drawn.clear();
    if (this.grouped || window.matchMedia?.("(max-width: 760px)").matches)
      return;
    const box = board.getBoundingClientRect();
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
    svg.setAttribute("aria-hidden", "true");
    const pinOf = (id) => {
      const el = board.querySelector(`[data-id="${id}"]`);
      if (!el || el.classList.contains("hide")) return null;
      const r = el.getBoundingClientRect();
      return [r.left + r.width / 2 - box.left, r.top + 2 - box.top];
    };
    const ids = this.findings.map((e) => e.finding.id);
    for (let i = 1; i < ids.length; i++) {
      const pa = pinOf(ids[i - 1]);
      const pb = pinOf(ids[i]);
      if (pa && pb) {
        const line = document.createElementNS(SVG, "line");
        line.setAttribute("x1", pa[0]);
        line.setAttribute("y1", pa[1]);
        line.setAttribute("x2", pb[0]);
        line.setAttribute("y2", pb[1]);
        const key = `${ids[i - 1]}-${ids[i]}`;
        if (!this._drawn.has(key)) {
          line.setAttribute("class", "new");
          this._drawn.add(key);
        }
        svg.appendChild(line);
      }
    }
    host.appendChild(svg);
  }
}
