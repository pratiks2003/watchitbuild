import { getConfig, agentStep, summarize, messageOf } from "c/xrayApi";
import apexGetConfig from "@salesforce/apex/XrayController.getConfig";
import apexAgentStep from "@salesforce/apex/XrayController.agentStep";
import apexSummarize from "@salesforce/apex/XrayController.summarize";

jest.mock(
  "@salesforce/apex/XrayController.getConfig",
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  "@salesforce/apex/XrayController.agentStep",
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  "@salesforce/apex/XrayController.summarize",
  () => ({ default: jest.fn() }),
  { virtual: true }
);

describe("c/xrayApi", () => {
  afterEach(() => jest.clearAllMocks());

  it("sends the context as JSON and parses the validated step", async () => {
    apexAgentStep.mockResolvedValue('{"agent":"theo","done":false}');
    const step = await agentStep({ questions: [], stepsUsed: 0 });
    expect(apexAgentStep).toHaveBeenCalledWith({
      contextJson: '{"questions":[],"stepsUsed":0}'
    });
    expect(step).toEqual({ agent: "theo", done: false });
  });

  it("parses the summary", async () => {
    apexSummarize.mockResolvedValue('{"story":["They sell tents."]}');
    expect((await summarize({ findings: [] })).story).toEqual([
      "They sell tents."
    ]);
  });

  it("reports the live crew as off when config cannot be read", async () => {
    apexGetConfig.mockRejectedValue({ body: { message: "No access" } });
    expect(await getConfig()).toMatchObject({
      enabled: false,
      error: "No access"
    });
  });

  it("surfaces the friendly server message, with a fallback", () => {
    expect(messageOf({ body: { message: "Please come back tomorrow." } })).toBe(
      "Please come back tomorrow."
    );
    expect(messageOf(undefined)).toBe(
      "Something went wrong. Please try again."
    );
  });
});
