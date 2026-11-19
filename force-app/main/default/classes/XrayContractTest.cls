@IsTest
private class XrayContractTest {
  private static String validStep() {
    return JSON.serialize(
      new Map<String, Object>{
        'agent' => 'ada',
        'say' => 'Stages first.',
        'caption' => new Map<String, Object>{
          'plain' => 'Ada reads the sales steps.',
          'tech' => 'Ada reads Opportunity.StageName.'
        },
        'action' => new Map<String, Object>{
          'tool' => 'getComponent',
          'args' => new Map<String, Object>{ 'name' => 'Closed_Won_Handoff' }
        },
        'finding' => new Map<String, Object>{
          'id' => 'stages',
          'title' => 'Four sales stages',
          'evidence' => 'Prospecting to Closed Won',
          'source' => 'Opportunity.StageName',
          'confidence' => 'confirmed',
          'group' => 'sell',
          'plain' => 'A deal goes through four steps.',
          'year' => 2018,
          'links' => new List<Object>{ 'objects', 'BAD LINK', 'stages' }
        },
        'question' => new Map<String, Object>{
          'id' => 'q2',
          'status' => 'done',
          'answer' => 'Four stages'
        },
        'challenge' => null,
        'done' => false
      }
    );
  }

  @IsTest
  static void acceptsAValidStepWrappedInCodeFences() {
    Map<String, Object> step = XrayContract.parseStep(
      'Here you go:\n```json\n' + validStep() + '\n```'
    );
    Assert.areEqual('ada', step.get('agent'));
    Map<String, Object> finding = (Map<String, Object>) step.get('finding');
    Assert.areEqual('confirmed', finding.get('confidence'));
    Assert.areEqual(
      new List<String>{ 'objects' },
      finding.get('links'),
      'Invalid and self links are dropped'
    );
    Map<String, Object> action = (Map<String, Object>) step.get('action');
    Assert.areEqual('getComponent', action.get('tool'));
  }

  @IsTest
  static void rejectsAnUnknownAgent() {
    String reply = validStep().replace('"agent":"ada"', '"agent":"mallory"');
    assertRejected(reply, 'agent');
  }

  @IsTest
  static void rejectsATool() {
    String reply = validStep().replace('getComponent', 'deleteAllRecords');
    assertRejected(reply, 'action.tool');
  }

  @IsTest
  static void rejectsAnUnknownConfidence() {
    assertRejected(
      validStep().replace('"confirmed"', '"certain"'),
      'finding.confidence'
    );
  }

  @IsTest
  static void rejectsTooManyArguments() {
    Map<String, Object> raw = (Map<String, Object>) JSON.deserializeUntyped(
      validStep()
    );
    raw.put(
      'action',
      new Map<String, Object>{
        'tool' => 'listComponents',
        'args' => new Map<String, Object>{
          'a' => 1,
          'b' => 2,
          'c' => 3,
          'd' => 4,
          'e' => 5
        }
      }
    );
    assertRejected(JSON.serialize(raw), 'too many keys');
  }

  @IsTest
  static void rejectsNestedArguments() {
    Map<String, Object> raw = (Map<String, Object>) JSON.deserializeUntyped(
      validStep()
    );
    raw.put(
      'action',
      new Map<String, Object>{
        'tool' => 'getComponent',
        'args' => new Map<String, Object>{
          'name' => new Map<String, Object>{ 'x' => 1 }
        }
      }
    );
    assertRejected(JSON.serialize(raw), 'simple value');
  }

  @IsTest
  static void stripsMarkupAndClipsLongText() {
    Map<String, Object> raw = (Map<String, Object>) JSON.deserializeUntyped(
      validStep()
    );
    raw.put('say', '<img src=x onerror=alert(1)>' + 'a'.repeat(300));
    Map<String, Object> step = XrayContract.parseStep(JSON.serialize(raw));
    String say = (String) step.get('say');
    Assert.isFalse(say.contains('<'), 'No markup survives');
    Assert.areEqual(120, say.length(), 'Clipped to the limit');
  }

  @IsTest
  static void requiresACaption() {
    Map<String, Object> raw = (Map<String, Object>) JSON.deserializeUntyped(
      validStep()
    );
    raw.remove('caption');
    assertRejected(JSON.serialize(raw), 'caption');
  }

  @IsTest
  static void fallsBackToThePlainCaptionWhenTechIsMissing() {
    Map<String, Object> raw = (Map<String, Object>) JSON.deserializeUntyped(
      validStep()
    );
    raw.put('caption', new Map<String, Object>{ 'plain' => 'Ada reads.' });
    Map<String, Object> caption = (Map<String, Object>) XrayContract.parseStep(
        JSON.serialize(raw)
      )
      .get('caption');
    Assert.areEqual('Ada reads.', caption.get('tech'));
  }

  @IsTest
  static void rejectsNonJson() {
    assertRejected('I think the answer is quote-to-cash.', 'not JSON');
    assertRejected('', 'empty');
  }

  @IsTest
  static void acceptsAValidSummaryAndRejectsBadLanes() {
    Map<String, Object> summary = new Map<String, Object>{
      'process' => new Map<String, Object>{
        'lanes' => new List<Object>{ 'Customer', 'Sales' },
        'steps' => new List<Object>{
          new Map<String, Object>{
            'lane' => 0,
            'label' => 'Enquiry',
            'confidence' => 'confirmed'
          },
          new Map<String, Object>{
            'lane' => 1,
            'label' => 'Deal',
            'confidence' => 'likely',
            'outside' => true
          }
        }
      },
      'story' => new List<Object>{ 'They sell tents.' },
      'lens' => new Map<String, Object>{
        'dev' => new List<Object>{ 'OrderTrigger creates shipments' }
      }
    };
    Map<String, Object> parsed = XrayContract.parseSummary(
      JSON.serialize(summary)
    );
    Map<String, Object> process = (Map<String, Object>) parsed.get('process');
    Assert.areEqual(2, ((List<Object>) process.get('steps')).size());

    ((Map<String, Object>) ((List<Object>) ((Map<String, Object>) summary.get(
          'process'
        ))
        .get('steps'))[0])
      .put('lane', 7);
    try {
      XrayContract.parseSummary(JSON.serialize(summary));
      Assert.fail('A step pointing at a missing lane must be rejected');
    } catch (XrayContract.ContractException e) {
      Assert.isTrue(e.getMessage().contains('lane'));
    }
  }

  private static void assertRejected(String reply, String expectedReason) {
    try {
      XrayContract.parseStep(reply);
      Assert.fail('Expected the contract to reject: ' + expectedReason);
    } catch (XrayContract.ContractException e) {
      Assert.isTrue(
        e.getMessage().contains(expectedReason),
        'Unexpected reason: ' + e.getMessage()
      );
    }
  }
}
