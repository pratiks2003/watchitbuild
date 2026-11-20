import { LightningElement, api } from "lwc";
import {
  EVENTS,
  firingOrder,
  leadConversion,
  objectsWithAutomation
} from "c/xrayFiring";
import { ICONS } from "c/xrayLayout";

const TYPE_LABEL = {
  flow: "Flow",
  processBuilder: "Process",
  trigger: "Trigger",
  validation: "Validation rule",
  workflow: "Workflow rule"
};

/**
 * "What fires when": pick an object and an event, see every automation that runs, in
 * Salesforce's order of execution. Built only from the org's own metadata, so it never
 * shows anything the org does not have.
 */
export default class XrayFiringPanel extends LightningElement {
  @api open = false;
  @api orgIndex;

  object = "";
  event = "update";
  filter = "";

  get panelCls() {
    return `overlay${this.open ? " open" : ""}`;
  }

  get ariaHidden() {
    return String(!this.open);
  }

  get objects() {
    return this.orgIndex ? objectsWithAutomation(this.orgIndex) : [];
  }

  get current() {
    if (this.object) return this.object;
    const objects = this.objects;
    return (
      objects.find((o) => o.name === "Opportunity")?.name ??
      objects[0]?.name ??
      ""
    );
  }

  get objectOptions() {
    const needle = this.filter.trim().toLowerCase();
    return this.objects
      .filter((o) => !needle || o.name.toLowerCase().includes(needle))
      .slice(0, 400)
      .map((o) => ({
        ...o,
        label: `${o.name} (${o.count})`,
        selected: o.name === this.current
      }));
  }

  get hasObjects() {
    return this.objects.length > 0;
  }

  get isLead() {
    return this.current === "Lead";
  }

  get eventTabs() {
    const tabs = EVENTS.map((e) => ({ ...e }));
    if (this.isLead) tabs.push({ k: "convert", label: "Converted" });
    return tabs.map((t) => ({
      ...t,
      cls: `tab${t.k === this.currentEvent ? " on" : ""}`,
      selected: String(t.k === this.currentEvent)
    }));
  }

  get currentEvent() {
    return this.event === "convert" && !this.isLead ? "update" : this.event;
  }

  get isConvert() {
    return this.currentEvent === "convert";
  }

  decorate(result) {
    let n = 0;
    return {
      ...result,
      phases: result.phases.map((p) => ({
        ...p,
        items: p.items.map((i) => {
          n++;
          return {
            ...i,
            key: `${p.k}-${i.name}`,
            n,
            icon: ICONS[i.type] ?? "◆",
            typeLabel: TYPE_LABEL[i.type] ?? i.type,
            callList: (i.calls ?? []).map((c, k) => ({ key: k, text: c })),
            signalText: (i.signals ?? []).join(" · ")
          };
        })
      })),
      empty: !result.total
    };
  }

  get result() {
    if (!this.orgIndex || !this.current || this.isConvert) return null;
    return this.decorate(
      firingOrder(this.orgIndex, this.current, this.currentEvent)
    );
  }

  get conversion() {
    if (!this.orgIndex || !this.isConvert) return null;
    const lc = leadConversion(this.orgIndex);
    return {
      note: lc.note,
      parts: lc.parts.map((p) => ({
        ...this.decorate(p),
        key: `${p.object}-${p.event}`
      })),
      code: lc.code.map((c) => ({
        ...c,
        key: c.name,
        text: `${c.name} (${c.type}${c.object ? ` on ${c.object}` : ""}): ${c.signals.join(", ")}`
      })),
      hasCode: lc.code.length > 0
    };
  }

  get emptyText() {
    const verb = { create: "created", update: "edited", delete: "deleted" }[
      this.currentEvent
    ];
    return `Nothing in this org runs automatically when a ${this.current} is ${verb}.`;
  }

  get inactiveText() {
    const n = this.result?.inactive ?? 0;
    return n
      ? `${n} inactive component${n > 1 ? "s" : ""} on ${this.current} not shown.`
      : "";
  }

  handleFilter(event) {
    this.filter = event.target.value;
  }

  handleObject(event) {
    this.object = event.target.value;
  }

  handleEvent(event) {
    this.event = event.currentTarget.dataset.k;
  }

  /** Lets the app open the panel on a given object and event (e.g. from chat). */
  @api
  show(object, event) {
    if (object) this.object = object;
    if (event) this.event = event;
  }

  handleClose() {
    this.dispatchEvent(new CustomEvent("close"));
  }

  handleKeydown(event) {
    if (event.key === "Escape") this.handleClose();
  }
}
