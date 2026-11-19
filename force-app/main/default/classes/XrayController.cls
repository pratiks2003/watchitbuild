/**
 * Guest-facing entry point for the Org X-Ray site.
 * The browser sends the investigation context; the model proposes the next step;
 * XrayContract decides what is allowed back. Visitor org data is never stored.
 */
public with sharing class XrayController {
  private static final Integer ATTEMPTS = 2;

  @AuraEnabled
  public static Map<String, Object> getConfig() {
    XrayLimits.Settings s = XrayLimits.settings();
    return new Map<String, Object>{
      'enabled' => s.enabled == true,
      'maxStepsPerRun' => s.maxStepsPerRun,
      'tools' => new List<String>(XrayContract.TOOLS)
    };
  }

  /** Returns the next investigation step as validated JSON. */
  @AuraEnabled
  public static String agentStep(String contextJson) {
    Map<String, Object> ctx = readContext(contextJson);
    XrayLimits.Settings s = XrayLimits.settings();
    String prompt = XrayPrompts.step(ctx, s.maxStepsPerRun);
    return JSON.serialize(callWithContract(prompt, false));
  }

  /** Returns the final process, story and role summaries as validated JSON. */
  @AuraEnabled
  public static String summarize(String contextJson) {
    Map<String, Object> ctx = readContext(contextJson);
    return JSON.serialize(callWithContract(XrayPrompts.summary(ctx), true));
  }

  /* ---------- internals ---------- */

  private static Map<String, Object> readContext(String contextJson) {
    XrayLimits.Settings s = XrayLimits.settings();
    if (
      String.isBlank(contextJson) || contextJson.length() > s.maxRequestChars
    ) {
      throw friendly(
        'That request is too large for the crew. Try a smaller part of the org.'
      );
    }
    try {
      Object parsed = JSON.deserializeUntyped(contextJson);
      if (parsed instanceof Map<String, Object>) {
        return (Map<String, Object>) parsed;
      }
    } catch (JSONException e) {
      // fall through to the friendly error below
    }
    throw friendly('The crew could not read that request.');
  }

  /**
   * Calls the model, validates against the contract, retries once with the reason.
   * All model calls happen before the single usage DML at the end.
   */
  private static Map<String, Object> callWithContract(
    String prompt,
    Boolean isSummary
  ) {
    XrayLimits.Settings s = XrayLimits.settings();
    try {
      XrayLimits.requireBudget(ATTEMPTS);
    } catch (XrayLimits.LimitException e) {
      throw friendly(e.getMessage());
    }
    Integer calls = 0;
    String reason;
    Map<String, Object> result;
    try {
      for (
        Integer attempt = 0; attempt < ATTEMPTS && result == null; attempt++
      ) {
        String reply = XrayModels.client()
          .generate(
            s.model,
            reason == null ? prompt : prompt + XrayPrompts.retryHint(reason)
          );
        calls++;
        try {
          result = isSummary
            ? XrayContract.parseSummary(reply)
            : XrayContract.parseStep(reply);
        } catch (XrayContract.ContractException e) {
          reason = e.getMessage();
        }
      }
    } catch (XrayModels.ModelException e) {
      recordQuietly(calls);
      throw friendly(e.getMessage());
    }
    recordQuietly(calls);
    if (result == null) {
      throw friendly(
        'Ada lost the thread for a moment. Please try that step again.'
      );
    }
    return result;
  }

  private static void recordQuietly(Integer calls) {
    if (calls > 0) {
      try {
        XrayLimits.record(calls);
      } catch (DmlException e) {
        // Usage counting must never break a visitor's investigation.
        System.debug(
          LoggingLevel.WARN,
          'Org X-Ray usage not recorded: ' + e.getMessage()
        );
      }
    }
  }

  private static AuraHandledException friendly(String message) {
    AuraHandledException e = new AuraHandledException(message);
    e.setMessage(message);
    return e;
  }
}
