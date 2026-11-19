import { reply, storyText, greeting, bestFinding } from "c/xrayChatBrain";

const F = (id, title, confidence, plain, evidence, source) => ({
  finding: { id, title, confidence, plain, evidence, source, group: "other" },
  agent: "ada"
});
const billing = F(
  "erp_bills",
  "Invoices come from the ERP",
  "likely",
  "The bill comes from a separate accounting system overnight.",
  "ErpSyncBatch upserts Invoice__c nightly",
  "ErpSyncBatch, ERP"
);
const stages = F(
  "stages",
  "Deals move through five stages",
  "confirmed",
  "A salesperson takes each deal through five steps.",
  "Opportunity.StageName has five values",
  "Opportunity.StageName"
);
const ctx = (findings, extra = {}) => ({
  findings,
  summary: null,
  challenges: [],
  style: "plain",
  activity: "Reading ErpSyncBatch",
  confidence: 60,
  ...extra
});

describe("c/xrayChatBrain", () => {
  it("answers from the best-matching finding, in plain words", () => {
    const r = reply("ada", "Who sends the invoice?", ctx([stages, billing]));
    expect(r.text).toContain("accounting system");
    expect(r.text).not.toContain("Invoice__c");
    expect(r.source).toBe("ErpSyncBatch, ERP");
  });

  it("uses technical evidence in technical style", () => {
    const r = reply(
      "ada",
      "Who sends the invoice?",
      ctx([billing], { style: "tech" })
    );
    expect(r.text).toContain("ErpSyncBatch upserts Invoice__c");
  });

  it("has Rex flag likely findings", () => {
    expect(
      reply("rex", "Tell me about the invoice", ctx([billing])).text.startsWith(
        "Only likely"
      )
    ).toBe(true);
  });

  it("never invents: no match means it says what it has", () => {
    const r = reply("ada", "What about payroll?", ctx([stages]));
    expect(r.text).toContain("only answer from what we've found");
    expect(reply("ada", "What about payroll?", ctx([])).text).toContain(
      "haven't found anything"
    );
  });

  it("tells the story from Ada's summary when the run finished", () => {
    expect(
      storyText([stages], {
        story: ["They sell tents.", "Deals have five steps."]
      })
    ).toBe("They sell tents. Deals have five steps.");
    expect(storyText([stages], null)).toContain("still digging");
  });

  it("reports Rex's challenges and confidence", () => {
    expect(
      reply(
        "rex",
        "What did you challenge?",
        ctx([billing], { challenges: ["We never saw the ERP."] })
      ).text
    ).toContain("We never saw the ERP.");
    expect(
      reply("rex", "How sure are you?", ctx([billing, stages])).text
    ).toContain("1 findings are confirmed, 1 likely");
  });

  it("matches on shared words", () => {
    expect(
      bestFinding("which stages do deals move through", [billing, stages])
        .finding.id
    ).toBe("stages");
    expect(greeting("pip", 4)).toContain("4 cards");
  });
});
