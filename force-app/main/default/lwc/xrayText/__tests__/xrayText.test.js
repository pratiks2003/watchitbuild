import { toSegments, toPlain } from "c/xrayText";

describe("c/xrayText", () => {
  it("splits bold and code into separate segments", () => {
    const segs = toSegments("**Ada** reads `OrderTrigger` now");
    expect(segs.map((s) => [s.text, s.bold, s.code])).toEqual([
      ["Ada", true, false],
      [" reads ", false, false],
      ["OrderTrigger", false, true],
      [" now", false, false]
    ]);
  });

  it("returns plain text untouched and never produces HTML", () => {
    const segs = toSegments("<img src=x onerror=alert(1)>");
    expect(segs).toHaveLength(1);
    expect(segs[0].plain).toBe(true);
    expect(segs[0].text).toBe("<img src=x onerror=alert(1)>");
  });

  it("handles empty input", () => {
    expect(toSegments("")).toEqual([]);
    expect(toSegments(undefined)).toEqual([]);
  });

  it("strips markup for plain-text contexts", () => {
    expect(toPlain("**Done.** Read `x`")).toBe("Done. Read x");
  });
});
