import { LightningElement, api } from "lwc";
import { AGENTS } from "c/xrayDemoData";

const ICONS = { open: "?", dig: "⛏", done: "✓", fixed: "↺" };
const STATUS_TEXT = {
  open: "not started",
  dig: "digging…",
  done: "answered",
  fixed: "answered after a correction"
};

/** Open questions, the crew's working theory, and the crew list. */
export default class XrayCaseFile extends LightningElement {
  /** @type {{id: string, text: string, answer: string, status: string}[]} */
  @api questions = [];
  @api theory = "";
  @api confidence = 0;

  get items() {
    return this.questions.map((q) => ({
      ...q,
      icon: ICONS[q.status],
      cls: `q ${q.status}`,
      detail:
        q.status === "done" || q.status === "fixed"
          ? q.answer
          : q.status === "dig"
            ? "digging…"
            : "",
      srStatus: STATUS_TEXT[q.status]
    }));
  }

  get crew() {
    return Object.entries(AGENTS).map(([key, a]) => ({
      key,
      ...a,
      initial: a.name[0],
      avatarStyle: `background:${a.color}`
    }));
  }

  get confidenceStyle() {
    return `width:${this.confidence}%`;
  }

  get confidenceText() {
    return `${this.confidence}%`;
  }

  handleChat(event) {
    this.dispatchEvent(
      new CustomEvent("crewchat", {
        detail: { agent: event.currentTarget.dataset.key }
      })
    );
  }
}
