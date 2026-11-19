/* eslint-disable @lwc/lwc/no-async-operation -- the dig is a timed animation: timers and rAF are intended */
import {
  SURF,
  ZT,
  SX,
  floorOf,
  artifactX,
  BUCKET_REST,
  PIP_FETCH
} from "c/xrayWorld";
import { CARDS, FLAGS } from "c/xrayDemoData";

class Aborted extends Error {}

/**
 * Plays the investigation: moves the crew in the world and reports progress to the UI.
 * UI hooks: reset, phase(n), caption({plain, tech}), activity(map), question(id, status),
 * theory(text, confidence), progress(p), addCard(id, instant), correct(id), done(instant).
 * In instant mode every step completes immediately, which builds the finished state.
 */
export class XrayDirector {
  constructor({ world, ui }) {
    this.world = world;
    this.ui = ui;
    this.token = 0;
    this.instant = false;
    this.courierQueue = Promise.resolve();
  }

  get speed() {
    return this.world.speed;
  }

  set speed(value) {
    this.world.speed = value;
  }

  async run({ instant = false } = {}) {
    const my = ++this.token;
    this.instant = instant;
    this.courierQueue = Promise.resolve();
    this.world.resetWorld();
    this.ui.reset();
    try {
      await this.script(my);
    } catch (error) {
      if (!(error instanceof Aborted)) throw error;
    } finally {
      if (my === this.token) this.instant = false;
    }
  }

  stop() {
    this.token++;
  }

  /* ---------- primitives ---------- */

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
        if (my !== this.token) {
          reject(new Aborted());
          return;
        }
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
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  async say(k, text, ms, my) {
    if (this.instant) return;
    this.world.say(k, text);
    this.wait(ms, my)
      .then(() => this.world.unsay(k, text))
      .catch(() => {});
    await this.wait(ms * 0.8, my);
  }

  setState(k, state) {
    this.world.chars[k].state = state;
  }

  face(k, dir) {
    this.world.chars[k].face = dir;
  }

  async dig(id, layer, my) {
    const sign = artifactX(id) > SX ? 1 : -1;
    if (!this.instant) {
      this.setState("ada", "dig");
      await this.wait(1300, my);
      this.setState("ada", "idle");
    }
    this.world.carve(layer, artifactX(id) + 0.1 * sign, !this.instant);
    this.world.reveal(id, this.instant);
  }

  async adaTo(layer, x, my) {
    const ada = this.world.chars.ada;
    const floor = floorOf(layer);
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
      await this.walk("ada", [[SX, floor, ZT]], my, 2.2);
    }
    ada.carve = layer;
    await this.walk("ada", [[x - 0.9 * sign, floor, ZT]], my, 2.0);
    ada.carve = null;
    ada.face = sign;
  }

  /** Bucket up the shaft, Pip runs it to the board, Noor pins it. Queued, so finds never collide. */
  courier(id, fromY, my) {
    if (this.instant) {
      this.ui.addCard(id, true);
      this.world.addMiniCard();
      return;
    }
    this.courierQueue = this.courierQueue
      .then(async () => {
        const w = this.world;
        this.ui.activity({ pip: "Hauling a finding up the shaft" });
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
        this.ui.activity({ pip: `Running "${CARDS[id].title}" to the board` });
        await this.walk("pip", [[8.4, SURF, 2.6]], my, 4.4, "run");
        w.chars.pip.carry.visible = false;
        this.setState("noor", "point");
        this.face("noor", 1);
        this.ui.addCard(id, false);
        w.addMiniCard();
        this.ui.activity({
          noor: `Pinning "${CARDS[id].title}"`,
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

  /* ---------- the investigation ---------- */

  async script(my) {
    const { ui, world } = this;
    const instant = this.instant;
    const at = (x, y, z) => [x, y, z];

    ui.progress(0);
    ui.phase(1);
    ui.theory("Not sure yet. Surveying the org…", 5);
    world.focus("theo", 1.6);
    ui.caption({
      plain:
        "**Theo** is walking the site and listing every object, to see what this business is about.",
      tech: "**Theo** is describing all objects and counting records per object."
    });
    ui.activity({
      theo: "Pegging out objects on the surface",
      ada: "Waiting to start digging"
    });
    ui.question("q1", "dig");
    await this.say("theo", "I'll peg out every object first.", 1800, my);
    // Theo walks to each flag in turn, so these awaits are sequential on purpose.
    /* eslint-disable no-await-in-loop */
    for (let i = 0; i < FLAGS.length; i++) {
      await this.walk("theo", [[FLAGS[i][1] - 0.6, SURF, 1.1]], my, 3.2);
      world.showFlag(i, instant);
      await this.wait(120, my);
    }
    /* eslint-enable no-await-in-loop */
    await this.say(
      "theo",
      "8 core objects. Sold to lodges and shops.",
      2200,
      my
    );
    ui.addCard("objects", instant);
    world.addMiniCard();
    ui.question("q1", "done");
    ui.theory(
      "Looks like quote-to-cash: Lead → Deal → Quote → Order → Invoice.",
      30
    );
    ui.progress(0.12);
    this.walk("theo", [[1.2, SURF, 1.6]], my).catch(() => {});
    if (!instant)
      this.say("pip", "Click any of us to ask what we found!", 2600, my).catch(
        () => {}
      );

    ui.phase(2);
    ui.question("q2", "dig");
    world.focus("ada", 1.9);
    ui.caption({
      plain:
        "**Ada** climbs down to **2018** to find how a sale moves from first contact to a signed deal.",
      tech: "**Ada** is reading `Opportunity.StageName` values and the Path config (created 2018)."
    });
    ui.activity({
      ada: "Digging in 2018 for the sales stages",
      theo: "Done surveying, resting"
    });
    await this.say("ada", "Stages first. Down to 2018.", 1600, my);
    await this.adaTo("2018", artifactX("a_stages"), my);
    if (!instant) world.pin("a_stages", "Reading: sales stages");
    await this.dig("a_stages", "2018", my);
    world.unpin();
    await this.say("ada", "Four stages, with a Path guiding reps.", 2000, my);
    this.courier("stages", floorOf("2018"), my);
    ui.question("q2", "done");
    ui.progress(0.22);

    ui.question("q3", "dig");
    ui.caption({
      plain:
        "**Ada** moves up to **2021** to see who has to say yes before a big discount.",
      tech: "**Ada** is reading approval processes on Quote (2021 layer)."
    });
    ui.activity({ ada: "Digging in 2021 for approval processes" });
    await this.adaTo("2021", artifactX("a_discount"), my);
    if (!instant) world.pin("a_discount", "Reading: discount approval");
    await this.dig("a_discount", "2021", my);
    world.unpin();
    await this.say(
      "ada",
      "Discounts over 20% go to the Sales Director.",
      2100,
      my
    );
    this.courier("discount", floorOf("2021"), my);
    world.focus(at(6, SURF + 1, 2), 1.7);
    ui.caption({
      plain:
        "**Rex** wants proof the rule is still used. **Ada** counts how often it ran. Counts only, nothing copied.",
      tech: "**Rex** challenges the finding. **Ada** counts approval runs for `Quote_Discount`."
    });
    ui.activity({ rex: "Questioning the discount finding" });
    this.face("rex", -1);
    await this.say("rex", "Prove it is still used.", 1700, my);
    world.focus("ada", 1.9);
    await this.say(
      "ada",
      "Active. 214 approvals this year. Counts only.",
      2100,
      my
    );
    ui.question("q3", "done");
    ui.theory(
      "Quote-to-cash with discount approvals. Still unknown: after the deal.",
      48
    );
    ui.progress(0.34);

    ui.question("q6", "dig");
    world.focus(at(7.5, SURF + 1, 2), 1.8);
    ui.caption({
      plain: "**Noor** makes a guess about refunds. **Rex** isn't convinced.",
      tech: "**Noor** infers from field access: Finance can edit `Case.Refund_Amount__c`. **Rex** flags it as unproven."
    });
    ui.activity({
      noor: "Testing a guess about refunds",
      rex: "Doubting the refund guess"
    });
    this.setState("noor", "point");
    ui.addCard("refundGuess", instant);
    world.addMiniCard();
    await this.say(
      "noor",
      "Finance can edit refund amounts. So Finance approves refunds?",
      2400,
      my
    );
    this.setState("noor", "idle");
    await this.say("rex", "Editing is not approving. Check it.", 1900, my);
    world.focus("ada", 1.9);
    ui.caption({
      plain:
        "**Ada** digs the other way in **2021** to check who really approves refunds.",
      tech: "**Ada** is reading approval process `Case_Refund`."
    });
    ui.activity({ ada: "Checking the refund approval in 2021" });
    await this.walk("ada", [[SX, floorOf("2021"), ZT]], my, 2.4);
    world.chars.ada.carve = "2021";
    await this.walk(
      "ada",
      [[artifactX("a_refund") + 0.9, floorOf("2021"), ZT]],
      my,
      2.0
    );
    world.chars.ada.carve = null;
    this.face("ada", -1);
    if (!instant) world.pin("a_refund", "Reading: refund approval");
    await this.dig("a_refund", "2021", my);
    world.unpin();
    await this.say(
      "ada",
      "Rex is right. Refunds go to the Support Lead.",
      2100,
      my
    );
    this.courier("refund", floorOf("2021"), my);
    ui.correct("refundGuess");
    ui.question("q6", "fixed");
    ui.progress(0.46);
    ui.activity({ rex: "Satisfied with the refund fix" });

    ui.question("q4", "dig");
    ui.caption({
      plain:
        "**Ada** checks **2024**: what happens the moment a deal is signed?",
      tech: "**Ada** is reading record-triggered flows on Opportunity (2024 layer)."
    });
    ui.activity({ ada: "Digging in 2024 for flows" });
    await this.adaTo("2024", artifactX("a_handoff"), my);
    if (!instant)
      world.pin("a_handoff", "Reading: what happens on a signed deal");
    await this.dig("a_handoff", "2024", my);
    world.unpin();
    await this.say(
      "ada",
      "A signed deal creates an Order by itself.",
      2000,
      my
    );
    this.courier("handoff", floorOf("2024"), my);
    ui.question("q4", "done");
    ui.progress(0.56);

    ui.question("q5", "dig");
    ui.caption({
      plain: "**Ada** follows the new order to see which team ships it.",
      tech: "**Ada** is following Order into `OrderTrigger` and its queue assignment."
    });
    ui.activity({ ada: "Following the Order into OrderTrigger" });
    world.chars.ada.carve = "2024";
    await this.walk(
      "ada",
      [[artifactX("a_ship") - 0.9, floorOf("2024"), ZT]],
      my,
      2.0
    );
    world.chars.ada.carve = null;
    this.face("ada", 1);
    if (!instant) world.pin("a_ship", "Reading: who ships the order");
    await this.dig("a_ship", "2024", my);
    world.unpin();
    await this.say(
      "ada",
      "The warehouse team gets it on their list.",
      2000,
      my
    );
    this.courier("ship", floorOf("2024"), my);
    ui.question("q5", "done");
    ui.theory(
      "Quote-to-cash: approvals, then order and shipping in Salesforce.",
      66
    );
    ui.progress(0.64);

    ui.question("q7", "dig");
    ui.caption({
      plain:
        "Nothing here makes invoices. **Ada** digs down to **2015**, the oldest layer, looking for another system.",
      tech: "No automation creates `Invoice__c`. **Ada** checks Apex batches and Named Credentials (2015 layer)."
    });
    ui.activity({ ada: "Digging deep into 2015 for invoicing" });
    await this.say(
      "ada",
      "Nothing here makes invoices. Going deeper.",
      1900,
      my
    );
    await this.adaTo("2015", artifactX("a_erp"), my);
    if (!instant) world.pin("a_erp", "Reading: where invoices come from");
    await this.dig("a_erp", "2015", my);
    world.unpin();
    await this.say(
      "ada",
      "An outside accounting system sends invoices nightly.",
      2200,
      my
    );
    this.courier("erp", floorOf("2015"), my);
    ui.question("q7", "done");
    ui.progress(0.74);

    ui.phase(3);
    ui.question("q8", "dig");
    world.focus("noor", 1.9);
    ui.caption({
      plain:
        "**Noor** counts how many deals sit at each step, to find where customers drop off. Counts only, nothing copied.",
      tech: "**Noor** runs `COUNT() GROUP BY StageName`. Aggregates only, no rows leave the org."
    });
    ui.activity({ noor: "Counting deals by stage", ada: "Climbing back up" });
    this.setState("noor", "point");
    await this.say("noor", "Counting deals by step. Nothing copied.", 2000, my);
    ui.addCard("drop", instant);
    world.addMiniCard();
    this.setState("noor", "idle");
    await this.say(
      "noor",
      "4 in 10 deals stall after the written offer.",
      1900,
      my
    );
    ui.question("q8", "done");
    ui.theory(
      "Quote-to-cash: approvals in Salesforce, invoicing in the accounting system. 9 steps across 6 teams.",
      88
    );
    ui.progress(0.86);

    world.focus("ada", 1.5);
    const ada = world.chars.ada;
    await this.walk("ada", [[SX, ada.y, ZT]], my, 2.6);
    await this.walk("ada", [[SX, SURF, ZT]], my, 2.4);
    await this.walk("ada", [[7.0, SURF, 3.4]], my, 3.2);
    this.face("ada", 1);
    await this.courierQueue;
    this.check(my);
    ui.progress(1);
    ui.phase(4);
    world.focus(null, 1);
    ui.caption({
      plain:
        "**Done.** 8 questions answered, 1 guess corrected. Scroll down for the process, the plain-words story and what it means for you.",
      tech: "**Done.** 41 lookups, 0 records copied. Process, evidence and automation map below."
    });
    ui.activity({
      ada: "Investigation closed, at the tent",
      noor: "Board complete",
      pip: "Resting",
      rex: "Convinced, for now",
      theo: "Resting"
    });
    await this.say(
      "ada",
      "Case closed. Click me for the story in plain words.",
      2600,
      my
    );
    this.setState("rex", "point");
    await this.say("rex", "Fine. I believe it.", 1500, my);
    this.setState("rex", "cross");
    ui.done(instant);
  }
}
