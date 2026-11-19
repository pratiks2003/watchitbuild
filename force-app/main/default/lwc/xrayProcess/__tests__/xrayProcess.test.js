import { createElement } from "lwc";
import XrayProcess from "c/xrayProcess";

const SUMMARY = {
  process: {
    lanes: ["Customer", "Sales", "ERP"],
    steps: [
      {
        lane: 0,
        label: "Enquiry",
        evidence: "Lead",
        confidence: "confirmed",
        outside: false
      },
      {
        lane: 1,
        label: "Deal won",
        evidence: "StageName",
        confidence: "confirmed",
        outside: false
      },
      {
        lane: 2,
        label: "Invoice sent",
        evidence: "ErpSyncBatch",
        confidence: "likely",
        outside: true
      }
    ]
  },
  story: ["They sell tents.", "The bill comes from another system."],
  lens: {
    dev: ["`ErpSyncBatch` writes invoices"],
    po: ["**Blind spot:** billing"],
    user: ["…when you sign a deal, an order appears"]
  },
  newHere: { tech: ["Read `OrderTrigger` first"], biz: ["1. A lead comes in"] }
};

const mount = (props) => {
  const el = createElement("c-xray-process", { is: XrayProcess });
  Object.assign(el, props);
  document.body.appendChild(el);
  return el;
};
const text = (el, sel) => el.shadowRoot.querySelector(sel)?.textContent ?? "";

describe("c-xray-process", () => {
  afterEach(() => {
    while (document.body.firstChild)
      document.body.removeChild(document.body.firstChild);
  });

  it("is hidden until the results are ready", () => {
    expect(
      mount({ visible: false, summary: SUMMARY })
        .shadowRoot.querySelector("section")
        .classList.contains("rolled")
    ).toBe(true);
  });

  it("shows real stats and the story from the summary", () => {
    const el = mount({ visible: true, summary: SUMMARY });
    expect(text(el, ".n")).toBe(
      "3 steps · 3 teams · 2 confirmed · 1 likely · 1 outside Salesforce"
    );
    expect(
      [...el.shadowRoot.querySelectorAll(".story li")].map(
        (li) => li.textContent
      )
    ).toEqual(SUMMARY.story);
  });

  it("shows the developer lens with code names", () => {
    const el = mount({ visible: true, audience: "dev", summary: SUMMARY });
    expect(text(el, ".lens h3")).toContain("Where the logic lives");
    expect(text(el, ".lens code")).toBe("ErpSyncBatch");
  });

  it("adds the right cheat sheet for a new developer or product owner", () => {
    expect(
      text(
        mount({
          visible: true,
          audience: "dev",
          newHere: true,
          summary: SUMMARY
        }),
        ".lens h4"
      )
    ).toBe("New developer cheat sheet");
    expect(
      text(
        mount({
          visible: true,
          audience: "po",
          newHere: true,
          summary: SUMMARY
        }),
        ".lens h4"
      )
    ).toBe("Your first-week business steps");
  });
});
