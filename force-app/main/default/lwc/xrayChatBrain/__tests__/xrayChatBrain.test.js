import { reply, storyText, greeting } from "c/xrayChatBrain";

const ctx = (ids, style = "plain") => ({
  found: new Set(ids),
  style,
  activity: "Digging in 2021",
  confidence: 48,
  latest: ids[ids.length - 1] ?? null
});

describe("c/xrayChatBrain", () => {
  it("refuses to answer about something not found yet", () => {
    const r = reply("ada", "Who sends the invoice?", ctx(["objects"]));
    expect(r.text).toContain("haven't dug there yet");
    expect(r.text).toContain("Who sends the invoice?");
  });

  it("answers in plain words without Salesforce terms once found", () => {
    const r = reply("ada", "Who sends the invoice?", ctx(["objects", "erp"]));
    expect(r.text).toContain("accounting system");
    expect(r.text).not.toContain("Invoice__c");
    expect(r.source).toContain("ErpSyncBatch");
  });

  it("answers with technical names in technical style", () => {
    const r = reply(
      "ada",
      "Who sends the invoice?",
      ctx(["objects", "erp"], "tech")
    );
    expect(r.text).toContain("ErpSyncBatch");
    expect(r.text).toContain("Invoice__c");
  });

  it("has Rex flag likely findings as unproven", () => {
    const r = reply("rex", "Tell me about the invoice", ctx(["erp"], "tech"));
    expect(r.text.startsWith("Only likely, not proven.")).toBe(true);
  });

  it("tells the story only from findings, and names the gaps", () => {
    const text = storyText(new Set(["objects", "stages"]));
    expect(text).toContain("outdoor gear");
    expect(text).toContain("still digging");
    expect(text).toContain("who sends the bill");
  });

  it("reports the current activity when asked", () => {
    expect(reply("ada", "What are you digging now?", ctx([])).text).toBe(
      "Digging in 2021."
    );
  });

  it("explains the correction only after it happened", () => {
    expect(
      reply("rex", "What did the crew get wrong?", ctx(["refundGuess"])).text
    ).toContain("Nothing proven wrong yet");
    expect(
      reply(
        "rex",
        "What did the crew get wrong?",
        ctx(["refundGuess", "refund"])
      ).text
    ).toContain("Support Lead");
  });

  it("greets with the live count", () => {
    expect(greeting("ada", 3)).toContain("3 findings");
  });
});
