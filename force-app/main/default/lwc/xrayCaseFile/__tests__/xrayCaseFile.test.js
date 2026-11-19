import { createElement } from "lwc";
import XrayCaseFile from "c/xrayCaseFile";

describe("c-xray-case-file", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it("shows answers only for answered questions", () => {
    const el = createElement("c-xray-case-file", { is: XrayCaseFile });
    el.questions = [
      { id: "q1", text: "Sell?", answer: "Gear", status: "done" },
      { id: "q2", text: "Steps?", answer: "Four", status: "dig" },
      { id: "q3", text: "Who?", answer: "Director", status: "open" }
    ];
    el.theory = "Quote-to-cash";
    el.confidence = 48;
    document.body.appendChild(el);
    const smalls = [...el.shadowRoot.querySelectorAll(".q small")].map(
      (s) => s.textContent
    );
    expect(smalls).toEqual(["Gear", "digging…", ""]);
    expect(
      el.shadowRoot
        .querySelector('[role="progressbar"]')
        .getAttribute("aria-valuenow")
    ).toBe("48");
  });

  it("asks to chat with a crew member", () => {
    const el = createElement("c-xray-case-file", { is: XrayCaseFile });
    document.body.appendChild(el);
    const handler = jest.fn();
    el.addEventListener("crewchat", handler);
    el.shadowRoot.querySelector('[data-key="rex"]').click();
    expect(handler.mock.calls[0][0].detail).toEqual({ agent: "rex" });
  });
});
