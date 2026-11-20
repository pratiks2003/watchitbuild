import {
  firingOrder,
  leadConversion,
  objectsWithAutomation,
  firingText
} from "c/xrayFiring";
import { reply } from "c/xrayChatBrain";
import { groundSummary } from "c/xrayAgentLoop";
import { readTrigger, readClass, flowFires } from "c/xrayIndexer";
import { runTool } from "c/xrayTools";
import { DEMO_ORG } from "c/xrayDemoOrg";

/** A small org with automation on Lead and Account, in deliberately shuffled order. */
function org() {
  const out = { objects: [], components: [] };
  readTrigger(
    "LeadTrigger",
    "trigger LeadTrigger on Lead (before update, after update) { if (Trigger.new[0].IsConverted) LeadHandler.afterConvert(Trigger.new); }",
    null,
    out
  );
  readClass(
    "LeadHandler",
    "/** Creates onboarding tasks for converted leads. */ public class LeadHandler { public static void afterConvert(List<Lead> leads) { for (Lead l : [SELECT Id, ConvertedAccountId FROM Lead]) {} insert new Task(); } }",
    null,
    new Set(["Lead", "Task", "Account"]),
    out
  );
  readClass(
    "WebToLead",
    "public class WebToLead { void go(Id id) { Database.LeadConvert lc = new Database.LeadConvert(); Database.convertLead(lc); } }",
    null,
    new Set(["Lead"]),
    out
  );
  out.components.push(
    {
      name: "Lead_After_Save_Scoring",
      type: "flow",
      object: "Lead",
      active: true,
      fires: flowFires("RecordAfterSave", "CreateAndUpdate", "20"),
      detail: {
        entryCriteria: "Rating EqualTo Hot",
        actions: ["Update this record"]
      }
    },
    {
      name: "Lead_After_Save_Assign",
      type: "flow",
      object: "Lead",
      active: true,
      fires: flowFires("RecordAfterSave", "Update", "10"),
      detail: { actions: ["Apex AssignOwner"] }
    },
    {
      name: "Lead_Before_Defaults",
      type: "flow",
      object: "Lead",
      active: true,
      fires: flowFires("RecordBeforeSave", "Create", null),
      detail: {}
    },
    {
      name: "Lead_Needs_Email",
      type: "validation",
      object: "Lead",
      active: true,
      detail: { rule: "ISBLANK(Email)", message: "Email is required" }
    },
    {
      name: "Old_Lead_Rule",
      type: "validation",
      object: "Lead",
      active: false,
      detail: {}
    },
    {
      name: "Lead_Notify",
      type: "workflow",
      object: "Lead",
      active: true,
      fires: { on: ["create", "update"] },
      detail: {}
    },
    {
      name: "Account_New_Welcome",
      type: "flow",
      object: "Account",
      active: true,
      fires: flowFires("RecordAfterSave", "Create", null, ["1 day after"]),
      detail: {}
    }
  );
  return {
    name: "Test",
    objects: [
      { name: "Lead", label: "Lead" },
      { name: "Account", label: "Account" },
      { name: "Booking__c", label: "Booking" }
    ],
    components: out.components,
    counts: {}
  };
}

describe("c/xrayFiring", () => {
  it("lists what runs on an edit, in Salesforce's order of execution", () => {
    const r = firingOrder(org(), "Lead", "update");
    expect(r.phases.map((p) => p.k)).toEqual([
      "btrig",
      "valid",
      "atrig",
      "wf",
      "aflow"
    ]);
    // after-save flows by trigger order, not by name
    expect(
      r.phases.find((p) => p.k === "aflow").items.map((i) => i.name)
    ).toEqual(["Lead_After_Save_Assign", "Lead_After_Save_Scoring"]);
    // the trigger shows the handler class it calls, with that class's own summary
    const trig = r.phases.find((p) => p.k === "btrig").items[0];
    expect(trig.calls[0]).toContain("LeadHandler: Creates onboarding tasks");
    expect(r.inactive).toBe(1);
    expect(r.total).toBe(6);
  });

  it("runs before-save flows first on create, and only what applies", () => {
    const r = firingOrder(org(), "Lead", "create");
    expect(r.phases[0]).toMatchObject({ k: "bflow" });
    expect(r.phases[0].items[0].name).toBe("Lead_Before_Defaults");
    // the trigger has no insert events, the Assign flow is update-only
    expect(JSON.stringify(r)).not.toContain("LeadTrigger");
    expect(JSON.stringify(r)).not.toContain("Lead_After_Save_Assign");
  });

  it("says plainly when nothing runs", () => {
    const r = firingOrder(org(), "Booking__c", "delete");
    expect(r.total).toBe(0);
    expect(firingText(r)).toMatch(/Nothing in this org runs automatically/);
  });

  it("follows a lead conversion into the records it creates, and finds code that converts", () => {
    const lc = leadConversion(org());
    expect(lc.parts.map((p) => `${p.object}:${p.event}`)).toEqual([
      "Lead:update",
      "Account:create"
    ]);
    expect(lc.parts[1].later[0]).toContain("Account_New_Welcome: 1 day after");
    const names = lc.code.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(["LeadTrigger", "LeadHandler", "WebToLead"])
    );
    expect(lc.code.find((c) => c.name === "WebToLead").signals).toContain(
      "converts leads"
    );
  });

  it("offers objects with automation, busiest first", () => {
    expect(objectsWithAutomation(org())[0]).toEqual({ name: "Lead", count: 6 });
  });

  it("understands older indexes from their text details", () => {
    const r = firingOrder(DEMO_ORG, "Opportunity", "update");
    expect(r.total).toBeGreaterThan(0);
  });

  it("is a crew tool, including the convert event", () => {
    const r = runTool(org(), "firingOrder", {
      object: "lead",
      event: "convert"
    });
    expect(r.leadConversion[0].runs).toContain("LeadTrigger");
    expect(
      runTool(org(), "firingOrder", { object: "Lead", event: "update" }).order
    ).toContain("1. LeadTrigger");
  });
});

describe("chat answers about what fires", () => {
  it("answers lead conversion from the org itself", () => {
    const a = reply(
      "ada",
      "check lead to account conversion if there is any automation",
      { index: org(), findings: [] }
    );
    expect(a.text).toContain("Converting a lead sets off this chain");
    expect(a.text).toContain("LeadTrigger");
    expect(a.text).toContain("WebToLead (converts leads)");
    expect(a.source).toMatch(/order of execution/);
  });

  it("answers per object and event, and says when nothing runs", () => {
    const idx = org();
    expect(
      reply("ada", "what fires when a lead is edited?", { index: idx }).text
    ).toMatch(/When a Lead is edited, 6 things run/);
    expect(
      reply("ada", "any automation when bookings are deleted?", { index: idx })
        .text
    ).toBe("When a Booking__c is deleted: nothing runs automatically.");
  });
});

describe("summary grounding", () => {
  it("downgrades process steps that cite nothing in the org", () => {
    const s = groundSummary(
      {
        process: {
          lanes: ["Sales"],
          steps: [
            {
              lane: 0,
              label: "Score",
              evidence: "Lead_After_Save_Scoring",
              confidence: "confirmed"
            },
            {
              lane: 0,
              label: "CPQ quote",
              evidence: "SBQQ__Quote__c",
              confidence: "confirmed"
            },
            {
              lane: 0,
              label: "ERP",
              evidence: "outside",
              confidence: "likely",
              outside: true
            }
          ]
        }
      },
      org()
    );
    expect(s.process.steps.map((x) => x.confidence)).toEqual([
      "confirmed",
      "guess",
      "likely"
    ]);
    expect(s.process.steps[1].ungrounded).toBe(true);
  });
});
