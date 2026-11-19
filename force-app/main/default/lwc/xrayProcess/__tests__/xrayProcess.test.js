import { createElement } from "lwc";
import XrayProcess from "c/xrayProcess";

const mount = (props) => {
  const el = createElement("c-xray-process", { is: XrayProcess });
  Object.assign(el, props);
  document.body.appendChild(el);
  return el;
};
const text = (el, sel) => el.shadowRoot.querySelector(sel)?.textContent ?? "";

describe("c-xray-process", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it("is hidden until the results are ready", () => {
    const el = mount({ visible: false });
    expect(
      el.shadowRoot.querySelector("section").classList.contains("rolled")
    ).toBe(true);
  });

  it("tells the plain-words story and lists what is still missing", () => {
    const el = mount({ visible: true, found: ["objects", "stages"] });
    const items = [...el.shadowRoot.querySelectorAll(".story li")];
    expect(items[0].textContent).toContain("outdoor gear");
    expect(items.some((li) => li.classList.contains("gap"))).toBe(true);
  });

  it("shows the developer lens with code names", () => {
    const el = mount({ visible: true, audience: "dev" });
    expect(text(el, ".lens h3")).toContain("Where the logic lives");
    expect(el.shadowRoot.querySelectorAll(".lens code").length).toBeGreaterThan(
      0
    );
  });

  it("adds a technical cheat sheet for a new developer", () => {
    const el = mount({ visible: true, audience: "dev", newHere: true });
    expect(text(el, ".lens h4")).toBe("New developer cheat sheet");
  });

  it("adds business steps for a new product owner", () => {
    const el = mount({ visible: true, audience: "po", newHere: true });
    expect(text(el, ".lens h3")).toContain("product owner");
    expect(text(el, ".lens h4")).toBe("Your first-week business steps");
  });
});
