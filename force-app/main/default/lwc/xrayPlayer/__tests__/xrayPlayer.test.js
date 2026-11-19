import { activityText } from "c/xrayPlayer";

jest.mock(
  "c/xrayWorld",
  () => ({
    SURF: 0.25,
    ZT: 4.65,
    SX: -7.5,
    BUCKET_REST: 1.15,
    PIP_FETCH: [-5.9, 0.25, 4.75]
  }),
  { virtual: true }
);

describe("c/xrayPlayer activityText", () => {
  const step = (action, extra = {}) => ({ agent: "ada", action, ...extra });

  it("describes each tool in plain words", () => {
    expect(
      activityText(
        step({ tool: "getComponent", args: { name: "OrderTrigger" } })
      )
    ).toBe("Reading OrderTrigger");
    expect(
      activityText(
        step({ tool: "countBy", args: { object: "Case", field: "Status" } })
      )
    ).toBe("Counting Case by Status");
    expect(
      activityText(step({ tool: "listComponents", args: { type: "approval" } }))
    ).toBe("Listing approval");
    expect(activityText(step({ tool: "listObjects", args: {} }))).toBe(
      "Listing every object"
    );
  });

  it("describes challenges and findings", () => {
    expect(activityText(step(null, { challenge: { text: "x" } }))).toBe(
      "Challenging a finding"
    );
    expect(
      activityText(
        step(null, { finding: { title: "Invoices come from the ERP" } })
      )
    ).toBe('Recording "Invoices come from the ERP"');
  });
});
