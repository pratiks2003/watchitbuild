import { createElement } from "lwc";
import XrayBoard from "c/xrayBoard";

global.ResizeObserver = class {
  observe() {}
  disconnect() {}
};

const entry = (id, group, confidence, agent = "ada") => ({
  finding: {
    id,
    title: `Title ${id}`,
    evidence: `Evidence ${id}`,
    source: `Source ${id}`,
    plain: `Plain ${id}`,
    group,
    confidence
  },
  agent,
  instant: true
});

const mount = (props) => {
  const el = createElement("c-xray-board", { is: XrayBoard });
  Object.assign(el, props);
  document.body.appendChild(el);
  return el;
};

describe("c-xray-board", () => {
  afterEach(() => {
    while (document.body.firstChild)
      document.body.removeChild(document.body.firstChild);
  });

  it("shows the empty state with no findings", () => {
    const el = mount({ findings: [] });
    expect(el.shadowRoot.querySelectorAll(".card")).toHaveLength(0);
    expect(
      el.shadowRoot.querySelector(".board").classList.contains("has")
    ).toBe(false);
  });

  it("renders each finding with its confidence, source and who found it", () => {
    const el = mount({
      findings: [
        entry("a", "sell", "confirmed", "theo"),
        entry("b", "bill", "likely")
      ]
    });
    const card = el.shadowRoot.querySelector('[data-id="b"]');
    expect(card.querySelector(".st").textContent).toBe("LIKELY");
    expect(card.querySelector(".src").textContent).toBe("Source b");
    expect(el.shadowRoot.querySelector('[data-id="a"] .ty').textContent).toBe(
      "SELL · THEO"
    );
  });

  it("grows taller when there are more findings", () => {
    const el = mount({
      findings: Array.from({ length: 12 }, (_, i) =>
        entry(`f${i}`, "other", "confirmed")
      )
    });
    expect(
      el.shadowRoot.querySelector(".board").getAttribute("style")
    ).toContain("height:808px");
  });

  it("filters cards by text", async () => {
    const el = mount({
      findings: [entry("a", "sell", "confirmed"), entry("b", "bill", "likely")]
    });
    const input = el.shadowRoot.querySelector("input");
    input.value = "evidence b";
    input.dispatchEvent(new CustomEvent("input"));
    await Promise.resolve();
    expect(
      el.shadowRoot.querySelector('[data-id="a"]').classList.contains("hide")
    ).toBe(true);
    expect(
      el.shadowRoot.querySelector('[data-id="b"]').classList.contains("hide")
    ).toBe(false);
  });

  it("asks the crew member who found a card", () => {
    const el = mount({ findings: [entry("a", "sell", "confirmed", "noor")] });
    const handler = jest.fn();
    el.addEventListener("ask", handler);
    el.shadowRoot.querySelector('[data-id="a"]').click();
    expect(handler.mock.calls[0][0].detail).toEqual({
      agent: "noor",
      findingId: "a",
      title: "Title a"
    });
  });

  it("groups by business stage, showing only stages with findings", () => {
    const el = mount({
      findings: [
        entry("a", "sell", "confirmed"),
        entry("b", "bill", "likely"),
        entry("c", "mystery", "guess")
      ],
      grouped: true
    });
    const heads = [
      ...el.shadowRoot.querySelectorAll(".colh span:first-child")
    ].map((s) => s.textContent);
    expect(heads).toEqual(["Sell", "Bill", "Other"]);
  });
});
