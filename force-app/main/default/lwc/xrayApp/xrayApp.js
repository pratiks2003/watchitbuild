import { LightningElement } from "lwc";
import { loadScript } from "lightning/platformResourceLoader";
import THREE_URL from "@salesforce/resourceUrl/three";
import { XrayWorld } from "c/xrayWorld";
import { XrayDirector } from "c/xrayDirector";
import { QUESTIONS, ROLES, AGENTS, CARDS } from "c/xrayDemoData";
import { toSegments } from "c/xrayText";

const PHASES = ["Survey", "Dig", "Verify", "Map"];
const TOTAL = { demo: 2140, big: 18640 };
const LOOKUPS = { demo: 41, big: 118 };
const ASK_FOR_CARD = {
  objects: "What does this business sell?",
  stages: "What are the sales stages?",
  discount: "Who approves discounts?",
  refundGuess: "Who approves refunds?",
  refund: "Who approves refunds?",
  handoff: "What happens after a deal is won?",
  ship: "Who ships the order?",
  erp: "Who sends the invoice?",
  drop: "Where do deals get stuck?"
};

/**
 * Org X-Ray shell: the 3D dig site, the live strip, and the panels around it.
 * Owns all investigation state; children receive it as read-only properties.
 */
export default class XrayApp extends LightningElement {
  role = "dev";
  newHere = false;
  big = false;
  fast = false;
  follow = true;
  xray = true;
  noGl = false;
  sceneStatus = "loading";

  phaseIndex = 0;
  caption = { plain: "Loading the dig site…", tech: "Loading the dig site…" };
  activity = {};
  questions = QUESTIONS.map((q) => ({ ...q, status: "open" }));
  theory = "";
  confidence = 0;
  progress = 0;
  cards = [];
  corrected = [];
  latest = null;
  resultsVisible = false;
  chatAgent = null;
  running = false;

  _booted = false;
  _reduceMotion = false;

  /* ---------- lifecycle ---------- */

  renderedCallback() {
    if (this._booted) return;
    this._booted = true;
    this._reduceMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this.boot();
  }

  disconnectedCallback() {
    clearTimeout(this._autoplay);
    this.director?.stop();
    this.world?.destroy();
  }

  async boot() {
    try {
      await loadScript(this, THREE_URL);
      this.world = new XrayWorld({
        THREE: window.THREE,
        host: this.refs.scene,
        labels: this.refs.labels,
        reduceMotion: this._reduceMotion,
        onAgentClick: (k) => this.openChat(k)
      });
      this.world.start();
      // "ok" only if the 3D canvas exactly covers the panel, so labels line up with objects.
      this.sceneStatus = this.world.fitsHost() ? "ok" : "failed";
    } catch {
      // No WebGL (or the library failed): the panels still tell the whole story.
      this.noGl = true;
      this.sceneStatus = "failed";
      this.world = null;
    }
    this.director = this.world
      ? new XrayDirector({ world: this.world, ui: this.uiHooks() })
      : null;
    await this.playFinished();
    if (!this._reduceMotion && this.director && !this._userTookControl) {
      // Let visitors see the finished sheet for a moment, then play the dig,
      // unless they already pressed a playback control.
      // eslint-disable-next-line @lwc/lwc/no-async-operation
      this._autoplay = setTimeout(() => this.play(), 1800);
    }
  }

  /** Builds the finished investigation instantly (also the no-3D and reduced-motion path). */
  async playFinished() {
    if (this.director) {
      await this.director.run({ instant: true });
    } else {
      const ui = this.uiHooks();
      ui.reset();
      Object.keys(CARDS).forEach((id) => ui.addCard(id, true));
      ui.correct("refundGuess");
      this.questions = this.questions.map((q) => ({
        ...q,
        status: q.id === "q6" ? "fixed" : "done"
      }));
      ui.theory(
        "Quote-to-cash: approvals in Salesforce, invoicing in the accounting system. 9 steps across 6 teams.",
        88
      );
      ui.phase(4);
      ui.progress(1);
      ui.caption({
        plain: "**Done.** Here is what the crew found.",
        tech: "**Done.** 41 lookups, 0 records copied."
      });
      ui.done(true);
    }
  }

  async play() {
    if (!this.director) return;
    this.running = true;
    try {
      await this.director.run({ instant: false });
    } finally {
      this.running = false;
    }
  }

  /* ---------- hooks the director calls ---------- */

  uiHooks() {
    return {
      reset: () => {
        this.cards = [];
        this.corrected = [];
        this.latest = null;
        this.resultsVisible = false;
        this.questions = QUESTIONS.map((q) => ({ ...q, status: "open" }));
        this.activity = {};
      },
      phase: (n) => {
        this.phaseIndex = n;
      },
      caption: (c) => {
        this.caption = c;
      },
      activity: (map) => {
        this.activity = { ...this.activity, ...map };
      },
      question: (id, status) => {
        this.questions = this.questions.map((q) => {
          return q.id === id ? { ...q, status } : q;
        });
      },
      theory: (text, confidence) => {
        this.theory = text;
        this.confidence = confidence;
      },
      progress: (p) => {
        this.progress = p;
        this.world?.setSky(p);
      },
      addCard: (id, instant) => {
        if (this.cards.some((c) => c.id === id)) return;
        this.cards = [...this.cards, { id, instant }];
        this.latest = id === "refundGuess" ? this.latest : id;
      },
      correct: (id) => {
        this.corrected = [...this.corrected, id];
      },
      done: () => {
        this.resultsVisible = true;
      }
    };
  }

  /* ---------- derived view state ---------- */

  get phases() {
    return PHASES.map((label, i) => ({
      label,
      key: label,
      cls:
        i + 1 < this.phaseIndex
          ? "done"
          : i + 1 === this.phaseIndex
            ? "on"
            : "",
      last: i === PHASES.length - 1
    }));
  }

  get style() {
    return ROLES[this.role].style;
  }

  get captionSegments() {
    return toSegments(
      this.style === "tech" ? this.caption.tech : this.caption.plain
    );
  }

  get explainingFor() {
    return `explaining for ${this.newHere ? "a new " : "a "}${ROLES[this.role].label.toLowerCase()}`;
  }

  get readCount() {
    return Math.round(
      this.progress * (this.big ? TOTAL.big : TOTAL.demo)
    ).toLocaleString();
  }

  get readTotal() {
    return (this.big ? TOTAL.big : TOTAL.demo).toLocaleString();
  }

  get lookups() {
    return Math.round(this.progress * (this.big ? LOOKUPS.big : LOOKUPS.demo));
  }

  /** For the guest smoke test: ok once the finished investigation is on the page. */
  get findingsStatus() {
    return this.cards.length >= 9 && this.resultsVisible ? "ok" : "loading";
  }

  get progressPct() {
    return Math.round(this.progress * 100);
  }

  get progressStyle() {
    return `width: ${Math.round(this.progress * 100)}%`;
  }

  get roleOptions() {
    return Object.entries(ROLES).map(([value, r]) => ({
      value,
      label: r.label,
      pressed: String(this.role === value)
    }));
  }

  get foundIds() {
    return this.cards.map((c) => c.id);
  }

  get chatActivity() {
    return this.chatAgent
      ? (this.activity[this.chatAgent] ?? "Waiting for the next job")
      : "";
  }

  get playLabel() {
    return this.running ? "↻ Restart the dig" : "▶ Start the dig";
  }

  get speedLabel() {
    return this.fast ? "1×" : "2×";
  }

  get pressedNewHere() {
    return String(this.newHere);
  }
  get pressedDemo() {
    return String(!this.big);
  }
  get pressedBig() {
    return String(this.big);
  }
  get pressedFast() {
    return String(this.fast);
  }
  get pressedFollow() {
    return String(this.follow);
  }
  get pressedXray() {
    return String(this.xray);
  }

  /* ---------- handlers ---------- */

  handleRole(event) {
    this.role = event.currentTarget.dataset.value;
  }

  toggleNewHere() {
    this.newHere = !this.newHere;
  }

  setDemo() {
    this.setSize(false);
  }

  setBig() {
    this.setSize(true);
  }

  setSize(big) {
    this.big = big;
    this.world?.setBig(big);
    if (big) {
      this.caption = {
        plain:
          "**Production-size org:** 18,640 components. The crew still opens only what answers a question, and the board groups findings by business stage so it stays readable.",
        tech: "**Production-size org:** 18,640 components. Agent lookups stay capped at ~120; the board groups by process stage with overflow counts."
      };
    }
  }

  /** Any playback control means the visitor is in charge: cancel the automatic replay. */
  takeControl() {
    this._userTookControl = true;
    clearTimeout(this._autoplay);
  }

  handlePlay() {
    this.takeControl();
    this.play();
  }

  async handleSkip() {
    this.takeControl();
    this.director?.stop();
    this.running = false;
    await this.playFinished();
  }

  toggleSpeed() {
    this.fast = !this.fast;
    if (this.director) this.director.speed = this.fast ? 2 : 1;
  }

  toggleFollow() {
    this.follow = !this.follow;
    if (this.world) this.world.follow = this.follow;
  }

  toggleXray() {
    this.xray = !this.xray;
    this.world?.setXray(this.xray);
  }

  handleOverview() {
    this.follow = true;
    this.world?.overview();
  }

  handleCrewChat(event) {
    this.openChat(event.detail.agent);
  }

  handleCardAsk(event) {
    const { agent, cardId } = event.detail;
    this.openChat(agent);
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    requestAnimationFrame(() => this.refs.chat?.ask(ASK_FOR_CARD[cardId]));
  }

  openChat(agent) {
    if (!AGENTS[agent]) return;
    this.chatAgent = agent;
    this.world?.setChatting(agent);
  }

  handleChatClose() {
    this.chatAgent = null;
    this.world?.setChatting(null);
  }
}
