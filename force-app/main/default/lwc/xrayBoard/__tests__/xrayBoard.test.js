import { createElement } from "lwc";
import XrayBoard from "c/xrayBoard";

global.ResizeObserver = class {
  observe() {}
  disconnect() {}
};

const mount = (props) => {
  const el = createElement("c-xray-board", { is: XrayBoard });
  Object.assign(el, props);
  document.body.appendChild(el);
  return el;
};
const cards = (el) => [...el.shadowRoot.querySelectorAll(".card")];

describe("c-xray-board", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it("shows the empty state with no cards", () => {
    const el = mount({ cards: [] });
    expect(cards(el)).toHaveLength(0);
    expect(
      el.shadowRoot.querySelector(".board").classList.contains("has")
    ).toBe(false);
  });

  it("renders a card per finding with its status", () => {
    const el = mount({
      cards: [
        { id: "objects", instant: true },
        { id: "erp", instant: true }
      ]
    });
    expect(cards(el)).toHaveLength(2);
    expect(el.shadowRoot.querySelector('[data-id="erp"] .st').textContent).toBe(
      "LIKELY"
    );
  });

  it("marks corrected findings", () => {
    const el = mount({
      cards: [{ id: "refundGuess", instant: true }],
      corrected: ["refundGuess"]
    });
    const card = el.shadowRoot.querySelector('[data-id="refundGuess"]');
    expect(card.classList.contains("wrong")).toBe(true);
    expect(card.querySelector(".st").textContent).toBe("CORRECTED");
  });

  it("filters cards by text", async () => {
    const el = mount({
      cards: [
        { id: "objects", instant: true },
        { id: "erp", instant: true }
      ]
    });
    const input = el.shadowRoot.querySelector("input");
    input.value = "nightly";
    input.dispatchEvent(new CustomEvent("input"));
    await Promise.resolve();
    expect(
      el.shadowRoot
        .querySelector('[data-id="objects"]')
        .classList.contains("hide")
    ).toBe(true);
    expect(
      el.shadowRoot.querySelector('[data-id="erp"]').classList.contains("hide")
    ).toBe(false);
  });

  it("asks the agent who found a card when it is clicked", () => {
    const el = mount({ cards: [{ id: "ship", instant: true }] });
    const handler = jest.fn();
    el.addEventListener("ask", handler);
    el.shadowRoot.querySelector('[data-id="ship"]').click();
    expect(handler.mock.calls[0][0].detail).toEqual({
      agent: "ada",
      cardId: "ship"
    });
  });

  it("groups cards into business stages for big orgs", () => {
    const el = mount({
      cards: [
        { id: "objects", instant: true },
        { id: "ship", instant: true }
      ],
      grouped: true
    });
    const cols = el.shadowRoot.querySelectorAll(".col");
    expect(cols).toHaveLength(5);
    expect(cols[0].querySelectorAll(".card")).toHaveLength(1);
    expect(cols[2].querySelectorAll(".card")).toHaveLength(1);
  });
});
