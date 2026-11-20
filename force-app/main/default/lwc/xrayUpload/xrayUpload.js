import { LightningElement, api } from "lwc";
import { loadScript } from "lightning/platformResourceLoader";
import JSZIP_URL from "@salesforce/resourceUrl/jszip";
import { buildIndex } from "c/xrayIndexer";
import {
  startSignIn,
  finishSignIn,
  isSignInReturn,
  readOrg,
  cleanDomain
} from "c/xrayConnect";

const MAX_ZIP_BYTES = 40 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const FOLDERS = new Set([
  "objects",
  "flows",
  "triggers",
  "classes",
  "approvalProcesses",
  "namedCredentials",
  "queues",
  "permissionsets",
  "pathAssistants",
  "standardValueSets",
  "workflows"
]);
const TYPES = [
  "CustomObject",
  "CustomObject:Account",
  "CustomObject:Contact",
  "CustomObject:Lead",
  "CustomObject:Opportunity",
  "CustomObject:Case",
  "CustomObject:Quote",
  "CustomObject:Order",
  "CustomObject:Product2",
  "Flow",
  "ApexTrigger",
  "ApexClass",
  "ApprovalProcess",
  "NamedCredential",
  "Queue",
  "PermissionSet",
  "PathAssistant",
  "StandardValueSet:OpportunityStage",
  "StandardValueSet:CaseStatus",
  "StandardValueSet:LeadStatus",
  "Workflow"
];

/**
 * "Use your org": one sf command, then the zip is read and indexed in this browser tab.
 * Nothing is uploaded to a server; the crew later sends only the slices it reads to the AI.
 */
export default class XrayUpload extends LightningElement {
  @api open = false;
  @api liveEnabled = false;

  tab = "signin";
  domain = "";
  alias = "my-sandbox";
  status = "";
  error = "";
  busy = false;
  index = null;
  copied = false;
  originCopied = false;

  connectedCallback() {
    if (isSignInReturn()) this.resumeSignIn();
  }

  /* ---------- tabs ---------- */

  get signInTab() {
    return this.tab === "signin";
  }

  get signInTabCls() {
    return `tab${this.signInTab ? " on" : ""}`;
  }

  get zipTabCls() {
    return `tab${this.signInTab ? "" : " on"}`;
  }

  get signInSelected() {
    return String(this.signInTab);
  }

  get zipSelected() {
    return String(!this.signInTab);
  }

  showSignIn() {
    this.tab = "signin";
  }

  showZip() {
    this.tab = "zip";
  }

  /* ---------- sign in ---------- */

  get siteOrigin() {
    return window.location.origin;
  }

  get signInDisabled() {
    return this.busy || !cleanDomain(this.domain);
  }

  handleDomain(event) {
    this.domain = event.target.value;
    this.error = "";
  }

  handleDomainKey(event) {
    if (event.key === "Enter" && !this.signInDisabled) this.handleSignIn();
  }

  async handleCopyOrigin() {
    try {
      await navigator.clipboard.writeText(this.siteOrigin);
      this.originCopied = true;
    } catch {
      // the origin is visible on screen; copying is a convenience
    }
  }

  get originCopyLabel() {
    return this.originCopied ? "Copied" : "Copy";
  }

  async handleSignIn() {
    this.error = "";
    this.index = null;
    try {
      this.status = "Taking you to your org's login page…";
      await startSignIn(this.domain);
    } catch (error) {
      this.status = "";
      this.error = error.message;
    }
  }

  /** Back from the login page: exchange the code in this tab, read the org, forget the token. */
  async resumeSignIn() {
    this.tab = "signin";
    this.busy = true;
    this.error = "";
    this.index = null;
    try {
      this.status = "Signing in…";
      const session = await finishSignIn();
      this.domain = session.domain;
      this.index = await readOrg(session, {
        onProgress: (label) => {
          this.status = `${label}…`;
        }
      });
      this.status = this.index.components.length ? "Ready." : "";
      if (!this.index.components.length) {
        this.error =
          "We could read your org but found no automation to investigate. Check your user can view setup and Apex.";
      }
    } catch (error) {
      this.status = "";
      this.error = error.message;
    } finally {
      this.busy = false;
    }
  }

  /* ---------- zip ---------- */

  get command() {
    const alias = (this.alias || "my-sandbox").replace(/[^\w.@-]/g, "");
    return `sf project retrieve start --target-org ${alias} --target-metadata-dir orgxray --zip-file-name orgxray.zip ${TYPES.map((t) => `-m ${t}`).join(" ")}`;
  }

  get panelCls() {
    return `overlay${this.open ? " open" : ""}`;
  }

  get ariaHidden() {
    return String(!this.open);
  }

  get hasIndex() {
    return Boolean(this.index);
  }

  get summaryText() {
    if (!this.index) return "";
    const types = {};
    this.index.components.forEach((c) => {
      types[c.type] = (types[c.type] ?? 0) + 1;
    });
    const parts = Object.entries(types)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${n} ${t}`)
      .join(" · ");
    return `${this.index.objects.length} objects · ${this.index.components.length} components (${parts})`;
  }

  get skippedText() {
    const s = this.index?.stats;
    if (!s) return "";
    const notes = [];
    if (s.skipped?.length)
      notes.push(
        `Not readable with your access: ${s.skipped.map((x) => x.split(":")[0].replace(/^Reading /, "")).join(", ")}`
      );
    if (s.skippedComponents)
      notes.push(
        `${s.skippedComponents} less important components left out to keep the dig readable`
      );
    if (s.unreadable) notes.push(`${s.unreadable} files could not be read`);
    return notes.join(" · ");
  }

  get showResting() {
    return this.hasIndex && !this.liveEnabled;
  }

  get startDisabled() {
    return !this.index || !this.liveEnabled || this.busy;
  }

  get copyLabel() {
    return this.copied ? "Copied" : "Copy";
  }

  handleAlias(event) {
    this.alias = event.target.value;
    this.copied = false;
  }

  async handleCopy() {
    try {
      await navigator.clipboard.writeText(this.command);
      this.copied = true;
    } catch {
      this.refs.command?.select?.();
    }
  }

  handleDragOver(event) {
    event.preventDefault();
  }

  handleDrop(event) {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) this.readZip(file);
  }

  handleFile(event) {
    const file = event.target.files?.[0];
    if (file) this.readZip(file);
  }

  async readZip(file) {
    this.error = "";
    this.index = null;
    if (!/\.zip$/i.test(file.name)) {
      this.error =
        "That isn't a zip file. Use the orgxray.zip the command created.";
      return;
    }
    if (file.size > MAX_ZIP_BYTES) {
      this.error =
        "That zip is over 40 MB. Retrieve fewer types, or a smaller sandbox.";
      return;
    }
    this.busy = true;
    try {
      this.status = "Opening the zip in your browser…";
      await loadScript(this, JSZIP_URL);
      const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
      const files = new Map();
      const wanted = [];
      zip.forEach((path, entry) => {
        const folder = path.split("/").slice(-2, -1)[0];
        if (!entry.dir && FOLDERS.has(folder)) wanted.push([path, entry]);
      });
      if (!wanted.length) {
        this.error =
          "No metadata found in that zip. Check it's the orgxray.zip from the command.";
        return;
      }
      let done = 0;
      for (const [path, entry] of wanted) {
        // eslint-disable-next-line no-await-in-loop -- read one file at a time to keep memory low
        const body = await entry.async("string");
        if (body.length <= MAX_FILE_BYTES) files.set(path, body);
        done++;
        if (done % 50 === 0)
          this.status = `Reading metadata: ${done} of ${wanted.length} files…`;
      }
      this.status = "Building the map of your org…";
      this.index = buildIndex(files, { name: "Your org" });
      this.status = this.index.components.length ? "Ready." : "";
      if (!this.index.components.length) {
        this.error =
          "We found objects but no automation in that zip, so there is little to investigate.";
      }
    } catch {
      this.error = "We couldn't read that zip. Try running the command again.";
    } finally {
      this.busy = false;
    }
  }

  handleStart() {
    if (this.startDisabled) return;
    this.dispatchEvent(
      new CustomEvent("index", { detail: { index: this.index } })
    );
  }

  handleClose() {
    this.dispatchEvent(new CustomEvent("close"));
  }

  handleKeydown(event) {
    if (event.key === "Escape") this.handleClose();
  }
}
