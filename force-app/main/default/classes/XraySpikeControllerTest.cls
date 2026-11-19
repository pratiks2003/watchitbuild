@IsTest
private class XraySpikeControllerTest {
  @IsTest
  static void returnsAStructuredResultEvenWhenTheModelIsUnavailable() {
    Test.startTest();
    Map<String, Object> result = XraySpikeController.pingModel();
    Test.stopTest();

    Assert.isTrue(
      result.containsKey('ok'),
      'Result must always say whether the call worked'
    );
    Assert.isTrue(
      result.containsKey('ms'),
      'Result must always include timing'
    );
    if (result.get('ok') == false) {
      Assert.isNotNull(result.get('error'), 'A failed call must explain why');
    }
  }
}
