import { buildLayout } from "c/xrayLayout";
import { DEMO_ORG } from "c/xrayDemoOrg";

describe("c/xrayLayout", () => {
  const layout = buildLayout(DEMO_ORG);

  it("buries components in the layer of the year they were built", () => {
    expect(layout.artifacts.Closed_Won_Handoff.layer).toBe("recent");
    expect(layout.artifacts.Quote_Discount.layer).toBe("mid");
    expect(layout.artifacts["Opportunity.StageName"].layer).toBe("older");
    expect(layout.artifacts.ErpSyncBatch.layer).toBe("oldest");
  });

  it("never uses the shaft column and never puts two components in one spot", () => {
    const spots = Object.values(layout.artifacts).map(
      (a) => `${a.layer}:${a.c}`
    );
    expect(new Set(spots).size).toBe(spots.length);
    expect(Object.values(layout.artifacts).some((a) => a.c === 4)).toBe(false);
  });

  it("marks inactive components as dead weight", () => {
    expect(layout.artifacts.Lead_Email_Alert.decoy).toBe(true);
    expect(layout.artifacts.OrderTrigger.decoy).toBe(false);
  });

  it("counts components per layer from the real index", () => {
    const total = layout.layers
      .filter((l) => l.k !== "now")
      .reduce((n, l) => n + l.count, 0);
    expect(total).toBe(DEMO_ORG.components.length);
    expect(layout.layers[0].count).toBe(DEMO_ORG.objects.length);
  });

  it("flags the eight busiest objects and is deterministic", () => {
    expect(layout.flags).toHaveLength(8);
    expect(layout.flags.map(([n]) => n)).toContain("Case");
    expect(buildLayout(DEMO_ORG)).toEqual(layout);
  });
});
