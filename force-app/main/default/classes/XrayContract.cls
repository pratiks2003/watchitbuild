/**
 * The contract every model response must meet before the browser acts on it.
 * The model proposes; this class decides. Unknown values are rejected, long text is
 * clipped, markup is stripped, and anything not in the contract is dropped.
 */
public with sharing class XrayContract {
  public class ContractException extends Exception {
  }

  public static final Set<String> AGENTS = new Set<String>{
    'ada',
    'theo',
    'noor',
    'rex'
  };
  public static final Set<String> TOOLS = new Set<String>{
    'listObjects',
    'describeObject',
    'listComponents',
    'getComponent',
    'countBy',
    'searchMetadata',
    'firingOrder'
  };
  public static final Set<String> CONFIDENCE = new Set<String>{
    'confirmed',
    'likely',
    'guess'
  };
  public static final Set<String> GROUPS = new Set<String>{
    'sell',
    'approve',
    'fulfil',
    'bill',
    'service',
    'other'
  };
  public static final Set<String> QUESTION_STATUS = new Set<String>{
    'dig',
    'done',
    'fixed'
  };

  private static final Pattern SLUG = Pattern.compile('^[a-z0-9_]{1,40}$');
  private static final Pattern QUESTION_ID = Pattern.compile('^q[0-9]{1,2}$');
  private static final Pattern ARG_KEY = Pattern.compile('^[a-zA-Z]{1,20}$');
  private static final Integer MAX_ARGS = 4;

  /* ---------- one investigation step ---------- */

  public static Map<String, Object> parseStep(String modelText) {
    Map<String, Object> raw = toMap(extractJson(modelText), 'step');
    Map<String, Object> step = new Map<String, Object>();

    step.put('agent', oneOf(raw.get('agent'), AGENTS, 'agent'));
    step.put('say', text(raw.get('say'), 120, false, 'say'));

    Map<String, Object> caption = optionalMap(raw.get('caption'), 'caption');
    if (caption == null) {
      throw new ContractException('caption is required');
    }
    String plain = text(caption.get('plain'), 220, true, 'caption.plain');
    String tech = text(caption.get('tech'), 220, false, 'caption.tech');
    step.put(
      'caption',
      new Map<String, Object>{
        'plain' => plain,
        'tech' => String.isBlank(tech) ? plain : tech
      }
    );

    step.put('action', parseAction(optionalMap(raw.get('action'), 'action')));
    step.put(
      'finding',
      parseFinding(optionalMap(raw.get('finding'), 'finding'))
    );
    step.put(
      'question',
      parseQuestion(optionalMap(raw.get('question'), 'question'))
    );

    Map<String, Object> challenge = optionalMap(
      raw.get('challenge'),
      'challenge'
    );
    step.put(
      'challenge',
      challenge == null
        ? null
        : new Map<String, Object>{
            'text' => text(challenge.get('text'), 140, true, 'challenge.text')
          }
    );
    step.put('done', raw.get('done') == true);
    return step;
  }

  private static Map<String, Object> parseAction(Map<String, Object> action) {
    if (action == null) {
      return null;
    }
    String tool = oneOf(action.get('tool'), TOOLS, 'action.tool');
    Map<String, Object> args = optionalMap(action.get('args'), 'action.args');
    Map<String, Object> cleanArgs = new Map<String, Object>();
    if (args != null) {
      if (args.size() > MAX_ARGS) {
        throw new ContractException('action.args has too many keys');
      }
      for (String key : args.keySet()) {
        if (!ARG_KEY.matcher(key).matches()) {
          throw new ContractException(
            'action.args key is not allowed: ' + key.abbreviate(30)
          );
        }
        Object value = args.get(key);
        if (value instanceof String) {
          cleanArgs.put(key, text(value, 120, false, 'action.args.' + key));
        } else if (
          value instanceof Integer ||
          value instanceof Decimal ||
          value instanceof Boolean
        ) {
          cleanArgs.put(key, value);
        } else if (value != null) {
          throw new ContractException(
            'action.args.' + key + ' must be a simple value'
          );
        }
      }
    }
    return new Map<String, Object>{ 'tool' => tool, 'args' => cleanArgs };
  }

  private static Map<String, Object> parseFinding(Map<String, Object> finding) {
    if (finding == null) {
      return null;
    }
    String id = slug(finding.get('id'), 'finding.id');
    List<String> links = new List<String>();
    Object rawLinks = finding.get('links');
    if (rawLinks instanceof List<Object>) {
      for (Object link : (List<Object>) rawLinks) {
        if (
          link instanceof String &&
          SLUG.matcher((String) link).matches() &&
          links.size() < 3 &&
          link != id
        ) {
          links.add((String) link);
        }
      }
    }
    Object rawYear = finding.get('year');
    Integer year = rawYear instanceof Integer &&
      (Integer) rawYear >= 1999 &&
      (Integer) rawYear <= 2100
      ? (Integer) rawYear
      : null;
    return new Map<String, Object>{
      'id' => id,
      'title' => text(finding.get('title'), 80, true, 'finding.title'),
      'evidence' => text(
        finding.get('evidence'),
        220,
        true,
        'finding.evidence'
      ),
      'source' => text(finding.get('source'), 140, false, 'finding.source'),
      'confidence' => oneOf(
        finding.get('confidence'),
        CONFIDENCE,
        'finding.confidence'
      ),
      'group' => oneOf(finding.get('group'), GROUPS, 'finding.group'),
      'plain' => text(finding.get('plain'), 320, true, 'finding.plain'),
      'year' => year,
      'links' => links
    };
  }

  private static Map<String, Object> parseQuestion(
    Map<String, Object> question
  ) {
    if (question == null) {
      return null;
    }
    Object id = question.get('id');
    if (
      !(id instanceof String) || !QUESTION_ID.matcher((String) id).matches()
    ) {
      throw new ContractException('question.id is not valid');
    }
    return new Map<String, Object>{
      'id' => id,
      'status' => oneOf(
        question.get('status'),
        QUESTION_STATUS,
        'question.status'
      ),
      'answer' => text(question.get('answer'), 90, false, 'question.answer')
    };
  }

  /* ---------- the final summary ---------- */

  public static Map<String, Object> parseSummary(String modelText) {
    Map<String, Object> raw = toMap(extractJson(modelText), 'summary');
    Map<String, Object> process = optionalMap(raw.get('process'), 'process');
    if (process == null) {
      throw new ContractException('process is required');
    }
    List<String> lanes = textList(
      process.get('lanes'),
      2,
      8,
      30,
      'process.lanes'
    );
    List<Object> steps = new List<Object>();
    Object rawSteps = process.get('steps');
    if (
      !(rawSteps instanceof List<Object>) ||
      ((List<Object>) rawSteps).size() < 2
    ) {
      throw new ContractException('process.steps needs at least 2 steps');
    }
    for (Object rawStep : (List<Object>) rawSteps) {
      if (steps.size() == 14) {
        break;
      }
      Map<String, Object> s = toMap(rawStep, 'process.step');
      Object lane = s.get('lane');
      if (
        !(lane instanceof Integer) ||
        (Integer) lane < 0 ||
        (Integer) lane >= lanes.size()
      ) {
        throw new ContractException('process.step.lane must point at a lane');
      }
      steps.add(
        new Map<String, Object>{
          'lane' => lane,
          'label' => text(s.get('label'), 40, true, 'process.step.label'),
          'evidence' => text(
            s.get('evidence'),
            60,
            false,
            'process.step.evidence'
          ),
          'confidence' => oneOf(
            s.get('confidence'),
            CONFIDENCE,
            'process.step.confidence'
          ),
          'outside' => s.get('outside') == true
        }
      );
    }
    Map<String, Object> lens = optionalMap(raw.get('lens'), 'lens');
    Map<String, Object> newHere = optionalMap(raw.get('newHere'), 'newHere');
    return new Map<String, Object>{
      'process' => new Map<String, Object>{
        'lanes' => lanes,
        'steps' => steps
      },
      'story' => textList(raw.get('story'), 1, 10, 320, 'story'),
      'lens' => new Map<String, Object>{
        'dev' => textList(lens?.get('dev'), 0, 8, 200, 'lens.dev'),
        'po' => textList(lens?.get('po'), 0, 8, 200, 'lens.po'),
        'user' => textList(lens?.get('user'), 0, 8, 200, 'lens.user')
      },
      'newHere' => new Map<String, Object>{
        'tech' => textList(newHere?.get('tech'), 0, 8, 200, 'newHere.tech'),
        'biz' => textList(newHere?.get('biz'), 0, 8, 200, 'newHere.biz')
      }
    };
  }

  /* ---------- helpers ---------- */

  /** Pulls the JSON object out of a model reply that may include code fences or chatter. */
  @TestVisible
  private static Object extractJson(String modelText) {
    if (String.isBlank(modelText)) {
      throw new ContractException('empty reply');
    }
    Integer first = modelText.indexOf('{');
    Integer last = modelText.lastIndexOf('}');
    if (first < 0 || last <= first) {
      throw new ContractException('reply is not JSON');
    }
    try {
      return JSON.deserializeUntyped(modelText.substring(first, last + 1));
    } catch (JSONException e) {
      throw new ContractException('reply is not valid JSON');
    }
  }

  private static Map<String, Object> toMap(Object value, String name) {
    if (!(value instanceof Map<String, Object>)) {
      throw new ContractException(name + ' must be an object');
    }
    return (Map<String, Object>) value;
  }

  private static Map<String, Object> optionalMap(Object value, String name) {
    return value == null ? null : toMap(value, name);
  }

  private static String oneOf(Object value, Set<String> allowed, String name) {
    if (!(value instanceof String) || !allowed.contains((String) value)) {
      throw new ContractException(
        name + ' must be one of ' + String.join(new List<String>(allowed), ', ')
      );
    }
    return (String) value;
  }

  private static String slug(Object value, String name) {
    if (!(value instanceof String) || !SLUG.matcher((String) value).matches()) {
      throw new ContractException(name + ' must be a lowercase slug');
    }
    return (String) value;
  }

  /** Plain text only: no markup, no control characters, clipped to max. */
  @TestVisible
  private static String text(
    Object value,
    Integer max,
    Boolean required,
    String name
  ) {
    if (value != null && !(value instanceof String)) {
      throw new ContractException(name + ' must be text');
    }
    String s = value == null ? '' : ((String) value);
    s = s.replaceAll('[<>]', '')
      .replaceAll('[\\x00-\\x1F\\x7F]', ' ')
      .normalizeSpace();
    if (required && String.isBlank(s)) {
      throw new ContractException(name + ' is required');
    }
    return s.length() > max ? s.left(max - 1) + '…' : s;
  }

  private static List<String> textList(
    Object value,
    Integer minItems,
    Integer maxItems,
    Integer maxLength,
    String name
  ) {
    List<String> out = new List<String>();
    if (value instanceof List<Object>) {
      for (Object item : (List<Object>) value) {
        if (out.size() == maxItems) {
          break;
        }
        String s = text(item, maxLength, false, name);
        if (String.isNotBlank(s)) {
          out.add(s);
        }
      }
    }
    if (out.size() < minItems) {
      throw new ContractException(
        name + ' needs at least ' + minItems + ' items'
      );
    }
    return out;
  }
}
