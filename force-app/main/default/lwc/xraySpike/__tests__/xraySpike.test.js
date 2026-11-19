import { createElement } from "lwc";
import XraySpike from "c/xraySpike";
import pingModel from "@salesforce/apex/XraySpikeController.pingModel";
import { loadScript } from "lightning/platformResourceLoader";

jest.mock(
  "@salesforce/apex/XraySpikeController.pingModel",
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  "lightning/platformResourceLoader",
  () => ({ loadScript: jest.fn() }),
  { virtual: true }
);

// Let pending promise chains (Apex mock, fetch mock, re-render) settle.
const flush = async () => {
  for (let i = 0; i < 10; i++) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
};
const check = (el, name) =>
  el.shadowRoot.querySelector(`[data-check="${name}"]`);

function mount() {
  const el = createElement("c-xray-spike", { is: XraySpike });
  document.body.appendChild(el);
  return el;
}

describe("c-xray-spike", () => {
  beforeEach(() => {
    loadScript.mockRejectedValue(new Error("three.js not available in jsdom"));
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve([{ version: "67.0" }, { version: "68.0" }])
      })
    );
  });

  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  it("reports the model call and the org API call as ok when both succeed", async () => {
    pingModel.mockResolvedValue({
      ok: true,
      ms: 900,
      userType: "Guest",
      text: '{"ok":true}'
    });
    const el = mount();
    await flush();
    await flush();

    expect(check(el, "ai").dataset.status).toBe("ok");
    expect(check(el, "ai").textContent).toContain("Guest");
    expect(check(el, "cors").dataset.status).toBe("ok");
    expect(check(el, "cors").textContent).toContain("68.0");
  });

  it("explains why when the model call fails", async () => {
    pingModel.mockResolvedValue({
      ok: false,
      ms: 5,
      userType: "Guest",
      error: "NoAccessException: no Einstein access"
    });
    const el = mount();
    await flush();
    await flush();

    expect(check(el, "ai").dataset.status).toBe("failed");
    expect(check(el, "ai").textContent).toContain("no Einstein access");
  });

  it("marks the 3D check as failed with the reason when three.js cannot load", async () => {
    pingModel.mockResolvedValue({
      ok: true,
      ms: 1,
      userType: "Guest",
      text: ""
    });
    const el = mount();
    await flush();
    await flush();

    expect(check(el, "three").dataset.status).toBe("failed");
    expect(check(el, "three").textContent).toContain("three.js not available");
  });

  it("says the org API was blocked when fetch throws", async () => {
    pingModel.mockResolvedValue({
      ok: true,
      ms: 1,
      userType: "Guest",
      text: ""
    });
    global.fetch = jest.fn(() =>
      Promise.reject(new TypeError("Failed to fetch"))
    );
    const el = mount();
    await flush();
    await flush();

    expect(check(el, "cors").dataset.status).toBe("failed");
    expect(check(el, "cors").textContent).toContain("blocked by CSP or CORS");
  });
});
