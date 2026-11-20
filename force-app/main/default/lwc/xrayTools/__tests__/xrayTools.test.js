import { runTool, orgSummary, targetOf, TOOL_NAMES } from "c/xrayTools";
import { DEMO_ORG } from "c/xrayDemoOrg";

describe("c/xrayTools", () => {
  it("summarises the org without any record data", () => {
    const s = orgSummary(DEMO_ORG);
    expect(s).toContain("Alder & Pine Outfitters");
    expect(s).toContain("Case (48115 records)");
    expect(s).toContain("approval");
  });

  it("describes an object with the components that touch it", () => {
    const r = runTool(DEMO_ORG, "describeObject", { name: "opportunity" });
    expect(r.name).toBe("Opportunity");
    expect(r.components.map((c) => c.name)).toContain("Closed_Won_Handoff");
    expect(r.countableFields).toContain("Opportunity.StageName");
  });

  it("filters components by type and object", () => {
    const r = runTool(DEMO_ORG, "listComponents", { type: "approval" });
    expect(r.items.map((c) => c.name).sort()).toEqual([
      "Case_Refund",
      "Quote_Discount"
    ]);
    expect(
      runTool(DEMO_ORG, "listComponents", { type: "flow", object: "Lead" })
        .total
    ).toBe(1);
  });

  it("returns a component's full detail", () => {
    expect(
      runTool(DEMO_ORG, "getComponent", { name: "ErpSyncBatch" }).detail.callout
    ).toBe("Named Credential ERP");
  });

  it("returns aggregate counts only", () => {
    const r = runTool(DEMO_ORG, "countBy", {
      object: "Opportunity",
      field: "StageName"
    });
    expect(r.counts.Proposal).toBe(2680);
    expect(r.note).toContain("No records");
  });

  it("searches metadata text", () => {
    const r = runTool(DEMO_ORG, "searchMetadata", { text: "Invoice__c" });
    expect(r.items.map((c) => c.name)).toContain("ErpSyncBatch");
    expect(
      runTool(DEMO_ORG, "searchMetadata", { text: "x" }).error
    ).toBeDefined();
  });

  it("never throws: unknown tools and names come back as errors", () => {
    expect(runTool(DEMO_ORG, "deleteEverything", {}).error).toContain(
      "Unknown tool"
    );
    expect(runTool(DEMO_ORG, "getComponent", { name: "Nope" }).error).toContain(
      "No component"
    );
    expect(runTool(DEMO_ORG, "describeObject", {}).error).toBeDefined();
  });

  it("clips very large results", () => {
    const big = {
      ...DEMO_ORG,
      components: Array.from({ length: 400 }, (_, i) => ({
        name: `C${i}`,
        type: "flow",
        detail: { x: "y".repeat(200) }
      }))
    };
    const r = runTool(big, "searchMetadata", { text: "yy" });
    expect(JSON.stringify(r).length).toBeLessThan(7000);
  });

  it("finds the component a step is digging into", () => {
    expect(
      targetOf(DEMO_ORG, {
        tool: "getComponent",
        args: { name: "OrderTrigger" }
      }).type
    ).toBe("trigger");
    expect(targetOf(DEMO_ORG, { tool: "listObjects", args: {} })).toBeNull();
    expect(TOOL_NAMES).toHaveLength(7);
  });
});
