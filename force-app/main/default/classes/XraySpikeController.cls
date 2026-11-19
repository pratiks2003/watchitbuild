/**
 * Phase 0 spike: can a guest user on the public site reach the Einstein Models API?
 * Temporary. Replaced by XrayController in phase 1.
 */
public with sharing class XraySpikeController {
  private static final String MODEL = 'sfdc_ai__DefaultGPT41';

  @AuraEnabled
  public static Map<String, Object> pingModel() {
    Map<String, Object> result = new Map<String, Object>{
      'userType' => UserInfo.getUserType()
    };
    Long started = System.currentTimeMillis();
    try {
      aiplatform.ModelsAPI.createGenerations_Request request = new aiplatform.ModelsAPI.createGenerations_Request();
      request.modelName = MODEL;
      aiplatform.ModelsAPI_GenerationRequest body = new aiplatform.ModelsAPI_GenerationRequest();
      body.prompt = 'Reply with exactly: {"ok":true}';
      request.body = body;
      aiplatform.ModelsAPI.createGenerations_Response response = new aiplatform.ModelsAPI()
        .createGenerations(request);
      result.put('ok', true);
      result.put('text', response.Code200?.generation?.generatedText);
    } catch (Exception e) {
      result.put('ok', false);
      result.put('error', e.getTypeName() + ': ' + e.getMessage());
    }
    result.put('ms', System.currentTimeMillis() - started);
    return result;
  }
}
