/* eslint-disable @lwc/lwc/no-async-operation -- typing effect and focus timing */
import { LightningElement, api } from "lwc";
import { AGENTS, SUGGESTIONS } from "c/xrayDemoData";
import { reply, greeting } from "c/xrayChatBrain";

let messageId = 0;

/** Chat drawer for one crew member. Answers only from the findings on the board. */
export default class XrayChat extends LightningElement {
  /** @type {{finding: object, agent: string}[]} */
  @api findings = [];
  @api summary = null;
  /** @type {string[]} Rex's challenges so far */
  @api challenges = [];
  @api activity = "";
  @api confidence = 0;
  @api defaultStyle = "plain";
  @api orgIndex = null;

  history = {};
  draft = "";
  typing = false;
  _agent = null;
  _style = null;

  @api
  get agent() {
    return this._agent;
  }
  set agent(value) {
    this._agent = value;
    if (value && !this.history[value]) {
      this.history = {
        ...this.history,
        [value]: [this.message("a", greeting(value, this.findingsCount))]
      };
    }
    if (value) {
      setTimeout(() => this.refs.input?.focus({ preventScroll: true }), 320);
    }
  }

  /** Ask a question on the visitor's behalf (used when a board card is clicked). */
  @api
  ask(text) {
    if (text) this.send(text);
  }

  get open() {
    return Boolean(this._agent);
  }

  get drawerCls() {
    return `chat${this.open ? " open" : ""}`;
  }

  get ariaHidden() {
    return String(!this.open);
  }

  get info() {
    return AGENTS[this._agent] ?? { name: "", role: "", color: "#7fd3ff" };
  }

  get initial() {
    return this.info.name.charAt(0);
  }

  get avatarStyle() {
    return `background:${this.info.color}`;
  }

  get placeholder() {
    return `Ask ${this.info.name} about the org`;
  }

  get style() {
    return this._style ?? this.defaultStyle;
  }

  get plainPressed() {
    return String(this.style === "plain");
  }

  get techPressed() {
    return String(this.style === "tech");
  }

  get findingsCount() {
    return (this.findings ?? []).length;
  }

  get messages() {
    const color = this.info.color;
    return (this.history[this._agent] ?? []).map((m) => ({
      ...m,
      cls: `m ${m.role}`,
      style: `--agc:${color}`,
      hasSource: Boolean(m.source)
    }));
  }

  get suggestions() {
    return (SUGGESTIONS[this._agent] ?? []).map((text) => ({
      key: text,
      text
    }));
  }

  message(role, text, source) {
    messageId += 1;
    return { key: `m${messageId}`, role, text, source };
  }

  push(agent, msg) {
    this.history = {
      ...this.history,
      [agent]: [...(this.history[agent] ?? []), msg]
    };
  }

  async send(text) {
    const agent = this._agent;
    const question = text.trim();
    if (!agent || !question) return;
    this.push(agent, this.message("u", question));
    this.typing = true;
    this.scrollDown();
    await this.pause(650);
    const answer = reply(agent, question, {
      findings: this.findings ?? [],
      summary: this.summary,
      challenges: this.challenges ?? [],
      style: this.style,
      activity: this.activity,
      confidence: this.confidence,
      index: this.orgIndex
    });
    this.typing = false;
    const msg = this.message("a", "", null);
    this.push(agent, msg);
    const words = answer.text.split(" ");
    for (let i = 1; i <= words.length; i++) {
      this.updateLast(agent, { text: words.slice(0, i).join(" ") });
      // eslint-disable-next-line no-await-in-loop
      await this.pause(20);
    }
    this.updateLast(agent, { source: answer.source });
    this.scrollDown();
  }

  updateLast(agent, patch) {
    const list = [...this.history[agent]];
    list[list.length - 1] = { ...list[list.length - 1], ...patch };
    this.history = { ...this.history, [agent]: list };
    this.scrollDown();
  }

  pause(ms) {
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    return new Promise((resolve) => setTimeout(resolve, reduce ? 0 : ms));
  }

  scrollDown() {
    requestAnimationFrame(() => {
      const box = this.refs.msgs;
      if (box) box.scrollTop = box.scrollHeight;
    });
  }

  handleDraft(event) {
    this.draft = event.target.value;
  }

  handleSubmit(event) {
    event.preventDefault();
    const text = this.draft;
    this.draft = "";
    this.refs.input.value = "";
    this.send(text);
  }

  handleSuggestion(event) {
    this.send(event.currentTarget.dataset.text);
  }

  setPlain() {
    this._style = "plain";
  }

  setTech() {
    this._style = "tech";
  }

  handleKeydown(event) {
    if (event.key === "Escape") this.close();
  }

  close() {
    this.dispatchEvent(new CustomEvent("close"));
  }
}
