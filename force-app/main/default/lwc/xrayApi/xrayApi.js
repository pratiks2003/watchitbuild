import apexGetConfig from "@salesforce/apex/XrayController.getConfig";
import apexAgentStep from "@salesforce/apex/XrayController.agentStep";
import apexSummarize from "@salesforce/apex/XrayController.summarize";

/** Turns an Apex/AuraHandledException error into the visitor-friendly message it carries. */
export function messageOf(error) {
  return (
    error?.body?.message ??
    error?.message ??
    "Something went wrong. Please try again."
  );
}

/** Site settings: is the live AI crew on, and how many steps may one run take. */
export async function getConfig() {
  try {
    return await apexGetConfig();
  } catch (error) {
    return {
      enabled: false,
      maxStepsPerRun: 0,
      tools: [],
      error: messageOf(error)
    };
  }
}

/** Asks the crew for the next step. Returns the validated step object. */
export async function agentStep(context) {
  return JSON.parse(
    await apexAgentStep({ contextJson: JSON.stringify(context) })
  );
}

/** Asks Ada for the final process, story and role summaries. */
export async function summarize(context) {
  return JSON.parse(
    await apexSummarize({ contextJson: JSON.stringify(context) })
  );
}
