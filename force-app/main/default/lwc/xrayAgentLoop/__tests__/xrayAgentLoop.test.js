import { AgentLoop, QUESTIONS } from "c/xrayAgentLoop";
import { DEMO_ORG } from "c/xrayDemoOrg";

const step = (over) => ({
  agent: "ada",
  say: "",
  caption: { plain: "p", tech: "t" },
  action: null,
  finding: null,
  question: null,
  challenge: null,
  done: false,
  ...over
});

function fakeApi(steps, summary = { story: ["They sell tents."] }) {
  const contexts = [];
  return {
    contexts,
    agentStep: jest.fn(async (ctx) => {
      contexts.push(ctx);
      const next = steps.shift();
      if (next instanceof Error) throw next;
      return next;
    }),
    summarize: jest.fn(async () => summary)
  };
}

describe("c/xrayAgentLoop", () => {
  it("runs tools locally, keeps findings and questions, then summarises", async () => {
    const api = fakeApi([
      step({
        agent: "theo",
        action: { tool: "listObjects", args: {} },
        question: { id: "q1", status: "dig", answer: "" }
      }),
      step({
        action: { tool: "getComponent", args: { name: "Quote_Discount" } },
        finding: {
          id: "discount",
          title: "Discounts over 20% need the Sales Director",
          confidence: "confirmed"
        },
        question: { id: "q3", status: "done", answer: "Sales Director" },
        done: true
      })
    ]);
    const events = [];
    const run = await new AgentLoop({
      index: DEMO_ORG,
      api,
      onEvent: (e) => events.push(e)
    }).run();

    expect(run.steps).toHaveLength(2);
    expect(run.steps[1].result.detail.approver).toBe("Role: Sales Director");
    expect(run.findings.map((f) => f.id)).toEqual(["discount"]);
    expect(run.questions.find((q) => q.id === "q3").status).toBe("done");
    expect(run.summary.story).toEqual(["They sell tents."]);
    expect(events.map((e) => e.type)).toEqual([
      "step",
      "step",
      "summary",
      "done"
    ]);
    expect(events[1].target.name).toBe("Quote_Discount");
    // the second request carried the first tool result back to the crew
    expect(api.contexts[1].last.result.length).toBe(DEMO_ORG.objects.length);
    expect(api.contexts[0].questions).toHaveLength(QUESTIONS.length);
  });

  it("stops at the step budget", async () => {
    const api = fakeApi(
      Array.from({ length: 10 }, () =>
        step({ action: { tool: "listObjects", args: {} } })
      )
    );
    const run = await new AgentLoop({
      index: DEMO_ORG,
      api,
      maxSteps: 3
    }).run();
    expect(run.steps).toHaveLength(3);
  });

  it("gives up after two errors in a row and reports them", async () => {
    const api = fakeApi([new Error("busy"), new Error("still busy"), step({})]);
    const events = [];
    const run = await new AgentLoop({
      index: DEMO_ORG,
      api,
      onEvent: (e) => events.push(e)
    }).run();
    expect(run.steps).toHaveLength(0);
    expect(events.filter((e) => e.type === "error")).toHaveLength(2);
    expect(api.summarize).not.toHaveBeenCalled();
  });

  it("nudges the crew when it repeats the same action", async () => {
    const same = () => step({ action: { tool: "listObjects", args: {} } });
    const api = fakeApi([same(), same(), same(), step({ done: true })]);
    await new AgentLoop({ index: DEMO_ORG, api }).run();
    expect(api.contexts[2].last.note).toContain("repeated");
  });

  it("replaces a finding when the crew corrects it", async () => {
    const api = fakeApi([
      step({
        finding: {
          id: "refunds",
          title: "Finance approves refunds?",
          confidence: "guess"
        }
      }),
      step({
        finding: {
          id: "refunds",
          title: "Support Lead approves refunds",
          confidence: "confirmed"
        },
        done: true
      })
    ]);
    const run = await new AgentLoop({ index: DEMO_ORG, api }).run();
    expect(run.findings).toHaveLength(1);
    expect(run.findings[0].confidence).toBe("confirmed");
  });
});

describe("c/xrayAgentLoop focus and journal", () => {
  it("keeps a journal and tells the crew to wrap up a question, then moves on", async () => {
    const look = () =>
      step({ agent: "theo", action: { tool: "listObjects", args: {} } });
    const api = fakeApi(Array.from({ length: 30 }, look));
    const events = [];
    await new AgentLoop({
      index: DEMO_ORG,
      api,
      maxSteps: 9,
      onEvent: (e) => events.push(e)
    }).run();

    expect(api.contexts[1].journal[0]).toMatchObject({
      n: 1,
      agent: "theo",
      did: "listObjects({})"
    });
    expect(api.contexts[1].journal[0].saw).toContain("objects:");
    expect(api.contexts[3].focus.instruction).toBeNull();
    expect(api.contexts[4].focus.instruction).toContain("Wrap up now");
    const skip = events.find((e) => e.type === "skip");
    expect(skip.question.id).toBe("q1");
    expect(api.contexts[7].focus.id).toBe("q2");
  });

  it("finishes when every question is answered, even without done", async () => {
    const answer = (id) =>
      step({ question: { id, status: "done", answer: "ok" } });
    const api = fakeApi(
      ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"]
        .map(answer)
        .concat([step({})])
    );
    const run = await new AgentLoop({ index: DEMO_ORG, api }).run();
    expect(run.steps).toHaveLength(8);
  });
});

describe("c/xrayAgentLoop verification beat", () => {
  it("asks Rex to challenge a likely finding, then asks the crew to re-check it", async () => {
    const likely = {
      id: "billing",
      title: "Invoices come from the ERP",
      confidence: "likely"
    };
    const api = fakeApi([
      step({
        action: { tool: "getComponent", args: { name: "ErpSyncBatch" } },
        finding: likely
      }),
      step({
        agent: "rex",
        challenge: { text: "We never saw inside the ERP." }
      }),
      step({
        action: { tool: "getComponent", args: { name: "ERP" } },
        finding: { ...likely, evidence: "Named Credential ERP" }
      }),
      step({ done: true })
    ]);
    await new AgentLoop({ index: DEMO_ORG, api }).run();
    expect(api.contexts[1].focus.instruction).toContain("Rex's turn");
    expect(api.contexts[2].focus.instruction).toContain(
      "Settle Rex's challenge"
    );
    expect(api.contexts[3].focus.instruction).toBeNull();
  });

  it("does not ask for a challenge after a confirmed finding", async () => {
    const api = fakeApi([
      step({
        finding: { id: "stages", title: "Four stages", confidence: "confirmed" }
      }),
      step({ done: true })
    ]);
    await new AgentLoop({ index: DEMO_ORG, api }).run();
    expect(api.contexts[1].focus.instruction).toBeNull();
  });
});

describe("c/xrayAgentLoop honesty guard", () => {
  const likely = {
    id: "billing",
    title: "Invoices come from the ERP",
    confidence: "likely",
    evidence: "ErpSyncBatch writes Invoice__c"
  };
  const readBatch = { tool: "getComponent", args: { name: "ErpSyncBatch" } };

  it("keeps a finding as likely when the re-check looked at nothing new", async () => {
    const api = fakeApi([
      step({ action: readBatch, finding: likely }),
      step({ agent: "rex", challenge: { text: "Not proven." } }),
      step({
        action: readBatch,
        finding: { ...likely, confidence: "confirmed" }
      }),
      step({ done: true })
    ]);
    const run = await new AgentLoop({ index: DEMO_ORG, api }).run();
    expect(run.findings[0].confidence).toBe("likely");
    expect(run.findings[0].evidence).toContain("no new evidence");
  });

  it("allows an upgrade when the re-check found new evidence", async () => {
    const api = fakeApi([
      step({ action: readBatch, finding: likely }),
      step({ agent: "rex", challenge: { text: "Not proven." } }),
      step({
        action: { tool: "getComponent", args: { name: "ERP" } },
        finding: { ...likely, confidence: "confirmed" }
      }),
      step({ done: true })
    ]);
    const run = await new AgentLoop({ index: DEMO_ORG, api }).run();
    expect(run.findings[0].confidence).toBe("confirmed");
  });

  it("does not charge verification steps to the next question", async () => {
    const api = fakeApi([
      step({
        question: { id: "q1", status: "done", answer: "x" },
        finding: { ...likely, id: "sells" }
      }),
      step({ agent: "rex", challenge: { text: "Not proven." } }),
      step({ action: { tool: "listObjects", args: {} } }),
      step({ action: { tool: "describeObject", args: { name: "Case" } } }),
      step({ done: true })
    ]);
    await new AgentLoop({ index: DEMO_ORG, api }).run();
    expect(api.contexts[4].focus).toMatchObject({ id: "q2", stepsSpent: 0 });
    expect(api.contexts[4].focus.instruction).toContain("NOW");
  });
});

describe("c/xrayAgentLoop challenge cap", () => {
  it("lets Rex challenge at most three findings per run", async () => {
    const likely = (id) =>
      step({ finding: { id, title: id, confidence: "likely" } });
    const rex = () => step({ agent: "rex", challenge: { text: "Prove it." } });
    const settle = (id) =>
      step({
        action: { tool: "getComponent", args: { name: id } },
        finding: { id, title: id, confidence: "likely" }
      });
    const script = [];
    ["a", "b", "c"].forEach((id) => script.push(likely(id), rex(), settle(id)));
    script.push(likely("d"), step({ done: true }));
    const api = fakeApi(script);
    await new AgentLoop({ index: DEMO_ORG, api }).run();
    const last = api.contexts[api.contexts.length - 1];
    expect(last.focus.instruction ?? "").not.toContain("Rex's turn");
  });
});
