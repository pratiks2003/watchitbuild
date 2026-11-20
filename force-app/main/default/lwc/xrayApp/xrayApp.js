import { LightningElement } from "lwc";
import { loadScript } from "lightning/platformResourceLoader";
import THREE_URL from "@salesforce/resourceUrl/three";
import { XrayWorld } from "c/xrayWorld";
import { XrayPlayer } from "c/xrayPlayer";
import { AgentLoop, QUESTIONS } from "c/xrayAgentLoop";
import { buildLayout } from "c/xrayLayout";
import { DEMO_ORG } from "c/xrayDemoOrg";
import { DEMO_RUN } from "c/xrayDemoRun";
import { ROLES, AGENTS } from "c/xrayDemoData";
import { toSegments } from "c/xrayText";
import { getConfig, agentStep, summarize, messageOf } from "c/xrayApi";
import { isSignInReturn } from "c/xrayConnect";

const PHASES = ["Survey", "Dig", "Verify", "Map"];
const freshQuestions = () =>
  QUESTIONS.map((q) => ({ ...q, status: "open", answer: "" }));

/**
 * Org X-Ray shell: the 3D dig site, the live strip, and the panels around it.
 * Everything shown comes from a real investigation: a recorded run of the demo org,
 * or a live run in this browser. Owns all state; children receive it read-only.
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
  liveConfig = null;
  mode = "replay"; // replay | live
  liveNote = "";
  uploadOpen = false;
  firingOpen = false;
  index = null; // the org being investigated (demo, upload or live)

  phaseIndex = 0;
  caption = { plain: "Loading the dig site…", tech: "Loading the dig site…" };
  activity = {};
  questions = freshQuestions();
  theory = "";
  confidence = 0;
  progress = 0;
  stepsPlayed = 0;
  findings = []; // [{ finding, agent, instant }] in discovery order
  challenges = [];
  summary = null;
  resultsVisible = false;
  chatAgent = null;
  running = false;

  _booted = false;
  _reduceMotion = false;
  _run = null;

  /* ---------- lifecycle ---------- */

  connectedCallback() {
    // Back from a visitor's login page: reopen the panel (it finishes the sign-in) and skip the demo autoplay.
    if (isSignInReturn()) {
      this.uploadOpen = true;
      this.takeControl();
    }
  }

  renderedCallback() {
    if (this._booted) return;
    this._booted = true;
    this._reduceMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this.boot();
  }

  disconnectedCallback() {
    clearTimeout(this._autoplay);
    this._loop?.stop();
    this.player?.stop();
    this.world?.destroy();
  }

  async boot() {
    this.index = DEMO_ORG;
    this.layout = buildLayout(this.index);
    getConfig().then((config) => {
      this.liveConfig = config;
    });
    const runPromise = this.loadRun();
    try {
      await loadScript(this, THREE_URL);
      this.buildWorld();
    } catch {
      // No WebGL (or the library failed): the panels still tell the whole story.
      this.noGl = true;
      this.sceneStatus = "failed";
      this.world = null;
    }
    this._run = await runPromise;
    await this.showFinished();
    if (
      !this._reduceMotion &&
      this.player &&
      this._run &&
      !this._userTookControl
    ) {
      // Show the finished sheet for a moment, then replay the dig, unless the visitor took over.
      // eslint-disable-next-line @lwc/lwc/no-async-operation
      this._autoplay = setTimeout(() => this.replay(), 1800);
    }
  }

  /** The recorded real run of the demo org (bundled as a module: fetching static resources is unreliable under LWS). */
  /** (Re)creates the 3D world and player for the current index. */
  buildWorld() {
    this.player?.stop();
    this.world?.destroy();
    this.layout = buildLayout(this.index);
    this.world = new XrayWorld({
      THREE: window.THREE,
      host: this.refs.scene,
      labels: this.refs.labels,
      layout: this.layout,
      reduceMotion: this._reduceMotion,
      onAgentClick: (k) => this.openChat(k)
    });
    this.world.start();
    this.world.follow = this.follow;
    this.world.setXray(this.xray);
    // "ok" only if the 3D canvas exactly covers the panel, so labels line up with objects.
    this.sceneStatus = this.world.fitsHost() ? "ok" : "failed";
    this.player = new XrayPlayer({ world: this.world, ui: this.uiHooks() });
    this.player.speed = this.fast ? 2 : 1;
  }

  async loadRun() {
    return DEMO_RUN?.steps?.length ? DEMO_RUN : null;
  }

  /** The finished investigation, instantly (also the no-3D and reduced-motion path). */
  async showFinished() {
    if (!this._run) {
      this.caption = {
        plain: "The recorded dig could not be loaded. Please refresh.",
        tech: "Recorded run unavailable."
      };
      return;
    }
    if (this.player) {
      await this.player.replay(this._run, { instant: true });
      return;
    }
    const ui = this.uiHooks();
    ui.reset();
    this._run.steps.forEach(({ step }) => {
      if (step.question)
        ui.question(
          step.question.id,
          step.question.status,
          step.question.answer
        );
      if (step.challenge) ui.challenge(step.challenge.text);
      if (step.finding) ui.addFinding(step.finding, step.agent, true);
    });
    ui.phase(4);
    ui.progress(1);
    ui.summary(this._run.summary);
    ui.caption({
      plain: "**Done.** Here is what the crew found.",
      tech: "**Done.** Findings, process and logic map below."
    });
    ui.done(true);
  }

  async replay() {
    if (!this.player || !this._run) return;
    this._loop?.stop();
    if (this.index !== DEMO_ORG) {
      this.index = DEMO_ORG;
      this.buildWorld();
    }
    this.mode = "replay";
    this.liveNote = "";
    this.running = true;
    try {
      await this.player.replay(this._run, { instant: false });
    } finally {
      this.running = false;
    }
  }

  /** Runs the real crew in this browser against the demo org, step by step. */
  async runLive() {
    if (!this.player || !this.liveConfig?.enabled) return;
    this._loop?.stop();
    this.mode = "live";
    this.liveNote = "Live AI crew · every step is a real model call";
    this.running = true;
    const my = this.player.begin({ instant: false });
    this._loop = new AgentLoop({
      index: this.index,
      api: { agentStep, summarize },
      maxSteps: this.liveConfig.maxStepsPerRun || 40,
      onEvent: (event) => {
        if (event.type === "error") {
          this.liveNote = messageOf(event.error);
        } else if (event.type !== "done") {
          this.player.enqueue(event, my);
        }
      }
    });
    try {
      const run = await this._loop.run();
      await this.player.queue;
      if (!run.summary && my === this.player.token) {
        this.liveNote =
          this.liveNote ||
          "The crew stopped early. Try again, or watch the recorded dig.";
      }
    } finally {
      this.running = false;
    }
  }

  /* ---------- hooks the player calls ---------- */

  uiHooks() {
    return {
      reset: () => {
        this.findings = [];
        this.challenges = [];
        this.summary = null;
        this.resultsVisible = false;
        this.questions = freshQuestions();
        this.activity = {};
        this.stepsPlayed = 0;
      },
      phase: (n) => {
        this.phaseIndex = n;
      },
      caption: (c) => {
        this.caption = c;
        this.stepsPlayed += 1;
      },
      activity: (map) => {
        this.activity = { ...this.activity, ...map };
      },
      question: (id, status, answer) => {
        this.questions = this.questions.map((q) => {
          return q.id === id ? { ...q, status, answer: answer || q.answer } : q;
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
      addFinding: (finding, agent, instant) => {
        const at = this.findings.findIndex((e) => e.finding.id === finding.id);
        const entry = { finding, agent, instant: instant || at >= 0 };
        this.findings =
          at >= 0
            ? this.findings.map((e, i) => (i === at ? entry : e))
            : [...this.findings, entry];
      },
      challenge: (text) => {
        this.challenges = [...this.challenges, text];
      },
      summary: (summary) => {
        this.summary = summary;
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
        i + 1 < this.phaseIndex ? "done" : i + 1 === this.phaseIndex ? "on" : ""
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
      this.progress * (this.layout?.totals.components ?? 0)
    ).toLocaleString();
  }

  get readTotal() {
    return (this.layout?.totals.components ?? 0).toLocaleString();
  }

  get modeText() {
    return this.mode === "live" ? "live AI run" : "replay of a real AI run";
  }

  /** For the guest smoke test: ok once a finished investigation is on the page. */
  get findingsStatus() {
    return this.findings.length >= 3 && this.resultsVisible ? "ok" : "loading";
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

  get chatActivity() {
    return this.chatAgent
      ? (this.activity[this.chatAgent] ?? "Waiting for the next job")
      : "";
  }

  get liveAvailable() {
    return Boolean(this.liveConfig?.enabled) && !this.noGl;
  }

  get liveLabel() {
    return this.running && this.mode === "live"
      ? "↻ Restart live run"
      : "✦ Run the live AI crew";
  }

  get replayLabel() {
    return this.running && this.mode === "replay"
      ? "↻ Restart the replay"
      : "▶ Replay the dig";
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
    this.big = false;
  }

  setBig() {
    this.big = true;
  }

  /** Any playback control means the visitor is in charge: cancel the automatic replay. */
  takeControl() {
    this._userTookControl = true;
    clearTimeout(this._autoplay);
  }

  handleReplay() {
    this.takeControl();
    this.replay();
  }

  handleLive() {
    this.takeControl();
    this.runLive();
  }

  async handleSkip() {
    this.takeControl();
    this._loop?.stop();
    this.player?.stop();
    this.running = false;
    if (this.index !== DEMO_ORG) {
      this.liveNote = "Stopped. Here is what the crew found so far.";
      this.resultsVisible = true;
      return;
    }
    this.mode = "replay";
    this.liveNote = "";
    await this.showFinished();
  }

  toggleSpeed() {
    this.fast = !this.fast;
    if (this.player) this.player.speed = this.fast ? 2 : 1;
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

  get isDemo() {
    return !this.index || this.index === DEMO_ORG;
  }

  /** A real org has too many findings for loose cards: always group them. */
  get groupedBoard() {
    return this.big || !this.isDemo;
  }

  openFiring() {
    this.firingOpen = true;
  }

  closeFiring() {
    this.firingOpen = false;
  }

  openUpload() {
    this.uploadOpen = true;
  }

  closeUpload() {
    this.uploadOpen = false;
  }

  /** A visitor's org was indexed in the browser: rebuild the dig site from it and send in the crew. */
  handleIndex(event) {
    this.takeControl();
    this.uploadOpen = false;
    this._loop?.stop();
    this.index = event.detail.index;
    this.buildWorld();
    this.runLive();
  }

  get orgLabel() {
    return this.index && this.index !== DEMO_ORG
      ? `${this.index.kind === "live" ? this.index.name : "Your org"} · stays in this browser`
      : "Alder & Pine Outfitters · demo org";
  }

  handleCrewChat(event) {
    this.openChat(event.detail.agent);
  }

  handleCardAsk(event) {
    const { agent, title } = event.detail;
    this.openChat(agent);
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    requestAnimationFrame(() => this.refs.chat?.ask(`Tell me about: ${title}`));
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
