/**
 * Access to the Einstein Models API behind an interface, so tests (and future
 * providers) can swap the implementation without touching callers.
 */
public with sharing class XrayModels {
  public interface Client {
    String generate(String modelName, String prompt);
  }

  public class ModelException extends Exception {
  }

  @TestVisible
  private static Client current;

  public static Client client() {
    if (current == null) {
      current = new EinsteinClient();
    }
    return current;
  }

  public class EinsteinClient implements Client {
    public String generate(String modelName, String prompt) {
      aiplatform.ModelsAPI.createGenerations_Request request = new aiplatform.ModelsAPI.createGenerations_Request();
      request.modelName = modelName;
      aiplatform.ModelsAPI_GenerationRequest body = new aiplatform.ModelsAPI_GenerationRequest();
      body.prompt = prompt;
      request.body = body;
      String text;
      try {
        aiplatform.ModelsAPI.createGenerations_Response response = new aiplatform.ModelsAPI()
          .createGenerations(request);
        text = response?.Code200?.generation?.generatedText;
      } catch (Exception e) {
        throw new ModelException(
          'The AI service is not available right now.',
          e
        );
      }
      if (String.isBlank(text)) {
        throw new ModelException('The AI service returned an empty answer.');
      }
      return text;
    }
  }
}
