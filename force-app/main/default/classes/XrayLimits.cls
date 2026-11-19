/**
 * Kill switch and daily AI budget for the public site.
 * Runs without sharing, with explicit system-mode DML, because the guest user has no
 * object access: the only thing written is one org-level counter row.
 */
public without sharing class XrayLimits {
  public class LimitException extends Exception {
  }

  public class Settings {
    public Boolean enabled = true;
    public Integer dailyStepCap = 1500;
    public Integer maxStepsPerRun = 45;
    public Integer maxRequestChars = 30000;
    public String model = 'sfdc_ai__DefaultGPT41';
  }

  @TestVisible
  private static Settings testSettings;

  public static Settings settings() {
    if (testSettings != null) {
      return testSettings;
    }
    Settings s = new Settings();
    Xray_Setting__mdt row = Xray_Setting__mdt.getInstance('Default');
    if (row != null) {
      s.enabled = row.Enabled__c;
      s.dailyStepCap = row.Daily_Step_Cap__c?.intValue() ?? s.dailyStepCap;
      s.maxStepsPerRun = row.Max_Steps_Per_Run__c?.intValue() ??
        s.maxStepsPerRun;
      s.maxRequestChars = row.Max_Request_Chars__c?.intValue() ??
        s.maxRequestChars;
      s.model = String.isBlank(row.Model_Name__c) ? s.model : row.Model_Name__c;
    }
    return s;
  }

  public static Integer usedToday() {
    Xray_Usage__c usage = Xray_Usage__c.getOrgDefaults();
    return usage?.Day__c == Date.today()
      ? (usage.Steps__c?.intValue() ?? 0)
      : 0;
  }

  /** Throws a visitor-friendly error if the site is switched off or today's budget is spent. */
  public static void requireBudget(Integer calls) {
    Settings s = settings();
    if (s.enabled != true) {
      throw new LimitException(
        'The live AI crew is resting right now. The recorded demo still works.'
      );
    }
    if (usedToday() + calls > s.dailyStepCap) {
      throw new LimitException(
        'The crew has done all the digging it can for today. Please come back tomorrow.'
      );
    }
  }

  /** Records AI calls. Call this AFTER the model call: no DML may precede a callout. */
  public static void record(Integer calls) {
    Xray_Usage__c usage = Xray_Usage__c.getOrgDefaults();
    if (usage.Day__c != Date.today()) {
      usage.Day__c = Date.today();
      usage.Steps__c = 0;
    }
    usage.Steps__c = (usage.Steps__c ?? 0) + calls;
    if (usage.Id == null) {
      usage.SetupOwnerId = UserInfo.getOrganizationId();
      Database.insert(usage, AccessLevel.SYSTEM_MODE);
    } else {
      Database.update(usage, AccessLevel.SYSTEM_MODE);
    }
  }
}
