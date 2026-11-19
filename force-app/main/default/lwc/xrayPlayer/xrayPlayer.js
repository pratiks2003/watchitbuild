/* eslint-disable @lwc/lwc/no-async-operation -- the investigation is a timed animation: timers and rAF are intended */
import { SURF, ZT, SX, BUCKET_REST, PIP_FETCH } from "c/xrayWorld";

class Aborted extends Error {}

const RANK = { guess: 0.4, likely: 0.75, confirmed: 1 };
const QUESTION_COUNT = 8;

/**
 * Plays an investigation in the 3D world, one real step at a time. The same player
 * drives a recorded replay and a live run, so what visitors see is always what the
 * crew actually did.
 *
 * UI hooks: reset, phase(n), caption({plain, tech}), activity(map), question(id, status, answer),
 * theory(text, confidence), progress(p), addFinding(finding, agent, instant),
 * challenge(text), summary(summary), done(instant)
 */
export class XrayPlayer {
  constructor({ world, ui }) {
    this.world = world;
    this.ui = ui;
    this.token = 0;
    this.instant = false;
    this.queue = Promise.resolve();
    this.courierQueue = Promise.resolve();
  }

  get speed() {
    return this.world.speed;
  }

  set speed(value) {
    this.world.speed = value;
  }

  /** Starts fresh. Returns the token that later calls must carry. */
  begin({ instant = false } = {}) {
    const my = ++this.token;
    this.instant = instant;
    this.queue = Promise.resolve();
    this.courierQueue = Promise.resolve();
    this.flagsPlanted = false;
    this.findings = new Map();
    this.answered = new Set();
    this.world.resetWorld();
    this.ui.reset();
    this.ui.phase(1);
    this.ui.progress(0);
    this.ui.theory("Not sure yet. Surveying the org…", 0);
    return my;
  }

  stop() {
    this.token++;
  }

  /** Plays a recorded run from start to finish. */
  async replay(run, { instant = false } = {}) {
    const my = this.begin({ instant });
    const total = run.steps.length || 1;
    try {
      for (let i = 0; i < run.steps.length; i++) {
        const { step, result } = run.steps[i];
        // eslint-disable-next-line no-await-in-loop -- steps play one after another
        await this.playStep(step, result, my);
        this.ui.progress(((i + 1) / total) * 0.92);
      }
      await this.finish(run.summary, my);
    } catch (error) {
      if (!(error instanceof Aborted)) throw error;
    } finally {
      if (my === this.token) this.instant = false;
    }
  }

  /** Queues a live event (from c/xrayAgentLoop) so animations never overlap. */
  enqueue(event, my) {
    this.queue = this.queue
      .then(async () => {
        if (my !== this.token) return;
        if (event.type === "step")
          await this.playStep(event.step, event.result, my);
        else if (event.type === "skip")
          this.ui.question(event.question.id, "done", event.question.answer);
        else if (event.type === "summary") await this.finish(event.summary, my);
        if (event.type === "step")
          this.ui.progress(
            Math.min(0.92, (this.answered.size / QUESTION_COUNT) * 0.92)
          );
      })
      .catch((error) => {
        if (!(error instanceof Aborted)) throw error;
      });
    return this.queue;
  }

  /* ---------- one step ---------- */

  async playStep(step, result, my) {
    const { ui, world } = this;
    const agent = step.agent;
    ui.caption(step.caption);
    ui.activity({ [agent]: activityText(step) });
    if (step.question) {
      ui.question(step.question.id, step.question.status, step.question.answer);
      if (step.question.status === "done" || step.question.status === "fixed")
        this.answered.add(step.question.id);
      if (step.question.id === "q8" && step.question.status === "dig")
        ui.phase(3);
    }

    const action = step.action;
    if (step.challenge) {
      world.focus("rex", 1.8);
      this.setState("rex", "point");
      await this.say("rex", step.challenge.text, 3200, my);
      this.setState("rex", "cross");
      ui.challenge(step.challenge.text);
    } else if (!action) {
      if (step.say) await this.say(agent, step.say, 2000, my);
    } else if (action.tool === "listObjects") {
      await this.survey(step, my);
    } else if (action.tool === "describeObject") {
      await this.visitFlag(step, action.args?.name, my);
    } else if (action.tool === "getComponent") {
      await this.open(step, action.args?.name, my);
    } else if (
      action.tool === "listComponents" ||
      action.tool === "searchMetadata"
    ) {
      world.pulse((result?.items ?? []).map((i) => i.name));
      this.setState(agent, "point");
      await this.say(
        agent,
        step.say || "Let me see what is buried here.",
        1900,
        my
      );
      this.setState(agent, "idle");
    } else if (action.tool === "countBy") {
      world.focus("noor", 1.9);
      this.setState("noor", "point");
      await this.say(
        agent === "noor" ? "noor" : agent,
        step.say || "Counting. Nothing copied.",
        1900,
        my
      );
      this.setState("noor", "idle");
    }

    if (step.finding) {
      this.recordFinding(step.finding, agent, my);
    }
  }

  recordFinding(finding, agent, my) {
    const first = !this.findings.has(finding.id);
    this.findings.set(finding.id, finding);
    if (first && this.findings.size === 1) this.ui.phase(2);
    const ada = this.world.chars.ada;
    const underground = ada.y < SURF - 0.1;
    if (first && underground && !this.instant) {
      this.courier(finding, agent, ada.y, my);
    } else {
      this.ui.addFinding(finding, agent, this.instant);
      if (first) this.world.addMiniCard();
    }
    this.updateTheory(finding);
  }

  updateTheory(latest) {
    let score = 0;
    this.findings.forEach((f) => {
      score += RANK[f.confidence] ?? 0.5;
    });
    const confidence = Math.min(96, Math.round((score / QUESTION_COUNT) * 100));
    this.ui.theory(latest.title, confidence);
  }

  async finish(summary, my) {
    const { world, ui } = this;
    const ada = world.chars.ada;
    if (ada.y < SURF - 0.1 || Math.abs(ada.x - SX) < 0.1) {
      world.focus("ada", 1.5);
      ada.carve = null;
      await this.walk("ada", [[SX, ada.y, ZT]], my, 2.6);
      await this.walk("ada", [[SX, SURF, ZT]], my, 2.4);
    }
    await this.walk("ada", [[7.0, SURF, 3.4]], my, 3.2);
    this.face("ada", 1);
    await this.courierQueue;
    this.check(my);
    ui.progress(1);
    ui.phase(4);
    world.focus(null, 1);
    ui.caption({
      plain:
        "**Done.** Scroll down for the process, the story in plain words, and what it means for you.",
      tech: "**Done.** Process, evidence and where the logic lives are below."
    });
    ui.activity({
      ada: "Investigation closed, at the tent",
      noor: "Board complete",
      pip: "Resting",
      rex: "Convinced, for now",
      theo: "Resting"
    });
    if (summary) ui.summary(summary);
    await this.say(
      "ada",
      "Case closed. Click me to ask about anything we found.",
      2600,
      my
    );
    ui.done(this.instant);
  }

  /* ---------- crew actions ---------- */

  async survey(step, my) {
    const { world } = this;
    world.focus("theo", 1.6);
    if (this.flagsPlanted) {
      await this.say(
        "theo",
        step.say || "Checking the objects again.",
        1800,
        my
      );
      return;
    }
    this.flagsPlanted = true;
    await this.say(
      "theo",
      step.say || "I'll peg out the main objects.",
      1800,
      my
    );
    for (let i = 0; i < world.FLAGS.length; i++) {
      // eslint-disable-next-line no-await-in-loop -- Theo walks to each flag in turn
      await this.walk("theo", [[world.FLAGS[i][1] - 0.6, SURF, 1.1]], my, 3.2);
      world.showFlag(i, this.instant);
      // eslint-disable-next-line no-await-in-loop
      await this.wait(100, my);
    }
  }

  async visitFlag(step, objectName, my) {
    const { world } = this;
    const x = world.flagX(objectName);
    if (step.agent === "theo" || x == null) {
      world.focus("theo", 1.7);
      if (x != null) {
        if (!this.flagsPlanted)
          world.showFlag(
            world.FLAGS.findIndex(([n]) => n === objectName),
            this.instant
          );
        await this.walk("theo", [[x - 0.6, SURF, 1.1]], my, 3.2);
      }
      await this.say("theo", step.say || `Looking at ${objectName}.`, 1900, my);
    } else {
      this.setState(step.agent, "point");
      await this.say(
        step.agent,
        step.say || `Looking at ${objectName}.`,
        1900,
        my
      );
      this.setState(step.agent, "idle");
    }
  }

  /** Ada digs to the component being opened (or points at it if it is already dug up). */
  async open(step, name, my) {
    const { world } = this;
    const x = world.artifactX(name);
    if (x == null) {
      this.setState(step.agent, "point");
      await this.say(step.agent, step.say || `Reading ${name}.`, 1900, my);
      this.setState(step.agent, "idle");
      return;
    }
    const layer = world.ARTIFACTS[name].layer;
    world.focus("ada", 1.9);
    if (world.found.has(name)) {
      world.pulse([name]);
      await this.say(
        step.agent === "ada" ? "ada" : step.agent,
        step.say || `Checking ${name} again.`,
        1900,
        my
      );
      return;
    }
    await this.adaTo(layer, x, my);
    if (!this.instant) world.pin(name, `Reading: ${name}`);
    await this.dig(name, layer, x, my);
    world.unpin();
    await this.say(
      step.agent === "ada" ? "ada" : step.agent,
      step.say || `Found ${name}.`,
      1900,
      my
    );
  }

  /* ---------- primitives (shared with the old scripted director) ---------- */

  check(my) {
    if (my !== this.token) throw new Aborted();
  }

  wait(ms, my) {
    if (this.instant) return Promise.resolve();
    return new Promise((resolve, reject) => {
      setTimeout(
        () => (my === this.token ? resolve() : reject(new Aborted())),
        ms / this.speed
      );
    });
  }

  setState(k, state) {
    this.world.chars[k].state = state;
  }

  face(k, dir) {
    this.world.chars[k].face = dir;
  }

  async say(k, text, ms, my) {
    if (this.instant || !text) return;
    this.world.say(k, text);
    this.wait(ms, my)
      .then(() => this.world.unsay(k, text))
      .catch(() => {});
    await this.wait(ms * 0.8, my);
  }

  walk(k, points, my, speed = 2.6, state) {
    const c = this.world.chars[k];
    if (this.instant) {
      const [x, y, z] = points[points.length - 1];
      if (Math.abs(x - c.x) > 0.01) c.face = x < c.x ? -1 : 1;
      if (c.carve)
        this.world.carve(c.carve, x + 0.6 * Math.sign(x - c.x || 1), false);
      Object.assign(c, { x, y, z, state: c.home.state ?? "idle" });
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      let i = 0;
      let prev = performance.now();
      const step = (now) => {
        const dt = (now - prev) / 1000;
        prev = now;
        const [tx, ty, tz] = points[i];
        const dx = tx - c.x;
        const dy = ty - c.y;
        const dz = tz - c.z;
        const d = Math.hypot(dx, dy, dz);
        c.state =
          state ??
          (Math.abs(dy) > Math.abs(dx) + Math.abs(dz) ? "climb" : "walk");
        if (Math.abs(dx) > 0.02) {
          c.face = dx < 0 ? -1 : 1;
          c.dirX = Math.sign(dx);
        }
        const move = speed * this.speed * dt;
        if (d <= move) {
          Object.assign(c, { x: tx, y: ty, z: tz });
          i++;
          if (i >= points.length) {
            c.state = "idle";
            resolve();
            return;
          }
        } else {
          c.x += (dx / d) * move;
          c.y += (dy / d) * move;
          c.z += (dz / d) * move;
        }
        if (my !== this.token) {
          c.state = "idle";
          reject(new Aborted());
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  async adaTo(layer, x, my) {
    const { world } = this;
    const ada = world.chars.ada;
    const floor = world.floorOf(layer);
    const sign = x > SX ? 1 : -1;
    if (ada.y >= SURF - 0.01) {
      await this.walk(
        "ada",
        [
          [SX, SURF, ZT],
          [SX, floor, ZT]
        ],
        my,
        2.2
      );
    } else {
      ada.carve = null;
      if (Math.abs(ada.x - SX) > 0.05)
        await this.walk("ada", [[SX, ada.y, ZT]], my, 2.4);
      if (Math.abs(ada.y - floor) > 0.05)
        await this.walk("ada", [[SX, floor, ZT]], my, 2.2);
    }
    ada.carve = layer;
    await this.walk("ada", [[x - 0.9 * sign, floor, ZT]], my, 2.0);
    ada.carve = null;
    ada.face = sign;
  }

  async dig(name, layer, x, my) {
    const sign = x > SX ? 1 : -1;
    if (!this.instant) {
      this.setState("ada", "dig");
      await this.wait(1300, my);
      this.setState("ada", "idle");
    }
    this.world.carve(layer, x + 0.1 * sign, !this.instant);
    this.world.reveal(name, this.instant);
  }

  /** Bucket up the cliff, Pip runs the card to the board, Noor pins it. Queued so finds never collide. */
  courier(finding, agent, fromY, my) {
    this.courierQueue = this.courierQueue
      .then(async () => {
        const w = this.world;
        this.ui.activity({ pip: "Hauling a finding up the cliff" });
        w.bucketCard.visible = true;
        await new Promise((resolve, reject) => {
          const start = performance.now();
          const duration = 1300 / this.speed;
          const step = (now) => {
            if (my !== this.token) {
              reject(new Aborted());
              return;
            }
            const k = Math.min(1, (now - start) / duration);
            w.bucket.position.y =
              fromY + 0.3 + (BUCKET_REST - fromY - 0.3) * (1 - (1 - k) ** 3);
            if (k < 1) requestAnimationFrame(step);
            else resolve();
          };
          requestAnimationFrame(step);
        });
        await this.walk("pip", [PIP_FETCH], my, 3);
        this.face("pip", -1);
        w.bucketCard.visible = false;
        w.chars.pip.carry.visible = true;
        this.ui.activity({ pip: `Running "${finding.title}" to the board` });
        await this.walk("pip", [[8.4, SURF, 2.6]], my, 4.4, "run");
        w.chars.pip.carry.visible = false;
        this.setState("noor", "point");
        this.face("noor", 1);
        this.ui.addFinding(finding, agent, false);
        w.addMiniCard();
        this.ui.activity({
          noor: `Pinning "${finding.title}"`,
          pip: "Heading back to the bucket"
        });
        await this.wait(500, my);
        this.setState("noor", "idle");
        this.face("noor", -1);
        await this.walk("pip", [[-6.2, SURF, 2.6]], my, 3.6);
        this.face("pip", 1);
        this.ui.activity({ pip: "Waiting at the bucket" });
      })
      .catch((error) => {
        if (!(error instanceof Aborted)) throw error;
      });
  }
}

/** Short, plain description of what an agent is doing, for the chat header and tags. */
export function activityText(step) {
  const a = step.action;
  if (step.challenge) return "Challenging a finding";
  if (!a)
    return step.finding
      ? `Recording "${step.finding.title}"`
      : "Thinking it over";
  const name =
    a.args?.name ?? a.args?.object ?? a.args?.type ?? a.args?.text ?? "";
  return (
    {
      listObjects: "Listing every object",
      describeObject: `Looking at ${name}`,
      listComponents: `Listing ${a.args?.type ?? "components"}${a.args?.object ? ` on ${a.args.object}` : ""}`,
      getComponent: `Reading ${name}`,
      countBy: `Counting ${a.args?.object ?? ""} by ${a.args?.field ?? ""}`,
      searchMetadata: `Searching for "${name}"`
    }[a.tool] ?? "Working"
  );
}
