import { LightningElement, api } from "lwc";
import { CARDS, GROUPS, STRINGS, AGENTS } from "c/xrayDemoData";

const SVG = "http://www.w3.org/2000/svg";

/** The cork evidence board. Pinned layout for small orgs, grouped by business stage for big ones. */
export default class XrayBoard extends LightningElement {
  /** @type {{id: string, instant: boolean}[]} */
  @api cards = [];
  /** @type {string[]} ids of findings later proven wrong */
  @api corrected = [];
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
    return this.cards.map(({ id, instant }) => {
      const c = CARDS[id];
      const wrong = this.corrected.includes(id);
      const status = wrong ? "corrected" : c.status;
      const hidden =
        Boolean(q) &&
        !`${c.type} ${c.title} ${c.evidence}`.toLowerCase().includes(q);
      return {
        id,
        group: c.group,
        type: c.type,
        title: c.title,
        evidence: c.evidence,
        ask: `ask ${AGENTS[c.by].name} →`,
        status: status.toUpperCase(),
        statusCls: `st ${status}`,
        cls: `card${wrong ? " wrong" : ""}${instant ? "" : " pin"}${hidden ? " hide" : ""}`,
        style: this.grouped ? "" : `left:${c.x}%;top:${c.y}%;--r:${c.r}deg`,
        label: `${c.title}. ${c.evidence}. ${status}. Ask ${AGENTS[c.by].name} about it.`
      };
    });
  }

  get columns() {
    const views = this.views;
    return GROUPS.map((g) => {
      const cards = views.filter((v) => v.group === g.id);
      return {
        ...g,
        cards,
        count: cards.length,
        moreText: `+ ${g.more} more findings`
      };
    });
  }

  get boardCls() {
    return `board${this.grouped ? " grouped" : ""}${this.cards.length ? " has" : ""}`;
  }

  get countText() {
    return `${this.cards.length} ${this.cards.length === 1 ? "card" : "cards"}`;
  }

  handleFilter(event) {
    this.filter = event.target.value;
  }

  handleAsk(event) {
    const id = event.currentTarget.dataset.id;
    this.dispatchEvent(
      new CustomEvent("ask", { detail: { agent: CARDS[id].by, cardId: id } })
    );
  }

  handleKey(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.handleAsk(event);
    }
  }

  /** Red string between related cards, measured after layout. Hidden when grouped or on phones. */
  drawStrings() {
    const host = this.refs.strings;
    const board = this.refs.board;
    if (!host || !board) return;
    host.textContent = "";
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
    STRINGS.forEach(([a, b]) => {
      const pa = pinOf(a);
      const pb = pinOf(b);
      if (!pa || !pb) return;
      const line = document.createElementNS(SVG, "line");
      line.setAttribute("x1", pa[0]);
      line.setAttribute("y1", pa[1]);
      line.setAttribute("x2", pb[0]);
      line.setAttribute("y2", pb[1]);
      const key = `${a}-${b}`;
      if (!this._drawn.has(key)) {
        line.setAttribute("class", "new");
        this._drawn.add(key);
      }
      svg.appendChild(line);
    });
    host.appendChild(svg);
    if (!this.cards.length) this._drawn.clear();
  }
}
