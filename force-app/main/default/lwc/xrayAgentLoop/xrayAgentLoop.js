import { runTool, orgSummary, targetOf, resultLine } from "c/xrayTools";

/** The questions every investigation works through, for any org. */
export const QUESTIONS = [
  { id: "q1", text: "What does this business sell, and to whom?" },
  { id: "q2", text: "How does a sale move from first contact to a deal?" },
  { id: "q3", text: "Who has to approve things, and when?" },
  { id: "q4", text: "What happens automatically after a deal is won?" },
  { id: "q5", text: "Who delivers to the customer?" },
  { id: "q6", text: "Who bills the customer?" },
  { id: "q7", text: "How are customer problems handled?" },
  { id: "q8", text: "Where do things get stuck?" }
];

const MAX_ERRORS_IN_A_ROW = 2;
const JOURNAL_SIZE = 16; // recent steps the crew remembers
const WRAP_UP_AFTER = 4; // steps on one question before the crew is told to conclude
const MOVE_ON_AFTER = 7; // steps on one question before the loop moves on by itself
const MAX_CHALLENGES = 3; // Rex challenges at most this many findings per run
const VERIFY_STEPS = 2; // steps allowed to settle a challenge before it must be recorded
const RANK = { guess: 0, likely: 1, confirmed: 2 };
const REPEAT_LIMIT = 2; // nudge as soon as the same action comes twice in a row

/**
 * The summary may only lean on what exists: a process step whose evidence names nothing
 * in this org (no component, no object) is downgraded to a guess, so the map never
 * presents invented automation as fact.
 */
export function groundSummary(summary, index) {
  if (!summary?.process?.steps) return summary;
  const known = new Set(
    [...index.components, ...index.objects].map((x) => x.name.toLowerCase())
  );
  const grounded = (evidence) =>
    String(evidence ?? "")
      .split(/[^A-Za-z0-9_.]+/)
      .some((w) => known.has(w.toLowerCase()));
  return {
    ...summary,
    process: {
      ...summary.process,
      steps: summary.process.steps.map((step) => {
        if (step.outside || grounded(step.evidence)) return step;
        return { ...step, confidence: "guess", ungrounded: true };
      })
    }
  };
}

/**
 * Runs an investigation: asks the server for one validated step at a time, runs the
 * step's read-only tool locally on the index, and keeps questions and findings.
 *
 * api: { agentStep(context), summarize(context) }  (see c/xrayApi)
 * onEvent({ type: 'step'|'summary'|'error'|'done', ... }) is called as things happen.
 * Returns the full run record, which is also the format the demo replays.
 */
export class AgentLoop {
  constructor({ index, api, maxSteps = 40, onEvent = () => {} }) {
    this.index = index;
    this.api = api;
    this.maxSteps = maxSteps;
    this.onEvent = onEvent;
    this.stopped = false;
  }

  stop() {
    this.stopped = true;
  }

  /** What the crew must do next: the verification beat wins over the question budget. */
  instructionFor(focusSteps, toChallenge, toVerify, verifySteps) {
    if (toChallenge) {
      return `Rex's turn: agent must be rex, action null, and challenge must say what is not yet proven about the finding "${toChallenge.title}" (id ${toChallenge.id}).`;
    }
    if (toVerify) {
      return verifySteps >= VERIFY_STEPS
        ? `Record the finding with id ${toVerify.id} again NOW, with the confidence your evidence supports. Only use confirmed if you saw new direct evidence.`
        : `Settle Rex's challenge on "${toVerify.title}": check ONE thing you have not looked at yet, then record the finding again with id ${toVerify.id}. Only use confirmed if you saw new direct evidence.`;
    }
    return focusSteps >= WRAP_UP_AFTER
      ? "Wrap up now: record your best finding (likely if not fully proven) and set this question to done."
      : null;
  }

  async run() {
    const questions = QUESTIONS.map((q) => ({
      ...q,
      status: "open",
      answer: ""
    }));
    const findings = [];
    const run = {
      org: this.index.name,
      startedAt: new Date().toISOString(),
      steps: [],
      summary: null
    };
    const summary = orgSummary(this.index);
    let last = null;
    let errors = 0;
    let repeats = 0;
    let previousAction = "";
    const journal = [];
    let focusId = null;
    let focusSteps = 0;
    let toChallenge = null; // a likely/guess finding Rex must challenge next
    let toVerify = null; // a challenged finding the crew must re-check
    let verifySteps = 0;
    let newEvidence = false; // did the crew look at anything new while verifying?
    const seenActions = new Set();
    let challenges = 0;

    while (!this.stopped && run.steps.length < this.maxSteps) {
      const focus = questions.find(
        (q) => q.status === "open" || q.status === "dig"
      );
      if (!focus) break; // every question answered
      if (focus.id !== focusId) {
        focusId = focus.id;
        focusSteps = 0;
      }
      if (focusSteps >= MOVE_ON_AFTER) {
        Object.assign(focus, {
          status: "done",
          answer: "Not provable from metadata alone"
        });
        this.onEvent({ type: "skip", question: { ...focus } });
        continue;
      }
      const context = {
        orgSummary: summary,
        focus: {
          id: focus.id,
          text: focus.text,
          stepsSpent: focusSteps,
          instruction: this.instructionFor(
            focusSteps,
            toChallenge,
            toVerify,
            verifySteps
          )
        },
        journal: journal.slice(-JOURNAL_SIZE),
        questions: questions.map(({ id, text, status }) => ({
          id,
          text,
          status
        })),
        findings: findings.map(({ id, title, confidence }) => ({
          id,
          title,
          confidence
        })),
        stepsUsed: run.steps.length,
        last
      };
      let step;
      try {
        // eslint-disable-next-line no-await-in-loop -- steps are sequential by design
        step = await this.api.agentStep(context);
        errors = 0;
      } catch (error) {
        errors++;
        this.onEvent({ type: "error", error });
        if (errors >= MAX_ERRORS_IN_A_ROW) break;
        continue;
      }
      if (this.stopped) break;

      const result = step.action
        ? runTool(this.index, step.action.tool, step.action.args)
        : null;
      if (step.finding) {
        const at = findings.findIndex((f) => f.id === step.finding.id);
        if (at >= 0) findings[at] = step.finding;
        else findings.push(step.finding);
      }
      if (step.question) {
        const q = questions.find((x) => x.id === step.question.id);
        if (q)
          Object.assign(q, {
            status: step.question.status,
            answer: step.question.answer || q.answer
          });
      }

      // Verification beat: likely/guess finding -> Rex challenges -> crew re-checks -> finding recorded again.
      // These steps do not count against the focus question's budget.
      const verifying = Boolean(toChallenge || toVerify);
      const actionKeyNow = step.action ? JSON.stringify(step.action) : null;
      if (toVerify) {
        verifySteps++;
        if (actionKeyNow && !seenActions.has(actionKeyNow)) newEvidence = true;
      }
      if (toVerify && step.finding?.id === toVerify.id) {
        // Honesty guard: certainty may only go up if the crew looked at something new.
        if (
          !newEvidence &&
          RANK[step.finding.confidence] > RANK[toVerify.confidence]
        ) {
          step.finding = {
            ...step.finding,
            confidence: toVerify.confidence,
            evidence:
              `${step.finding.evidence} (kept as ${toVerify.confidence}: no new evidence after the challenge)`.slice(
                0,
                260
              )
          };
          const at = findings.findIndex((f) => f.id === step.finding.id);
          if (at >= 0) findings[at] = step.finding;
        }
        toVerify = null;
      } else if (toChallenge && step.agent === "rex" && step.challenge) {
        toVerify = toChallenge;
        toChallenge = null;
        verifySteps = 0;
        newEvidence = false;
      } else if (
        step.finding &&
        step.agent !== "rex" &&
        ["likely", "guess"].includes(step.finding.confidence) &&
        !toVerify &&
        challenges < MAX_CHALLENGES
      ) {
        toChallenge = step.finding;
        challenges++;
      }
      if (actionKeyNow) seenActions.add(actionKeyNow);

      const actionKey = JSON.stringify(step.action ?? null);
      repeats = step.action && actionKey === previousAction ? repeats + 1 : 0;
      previousAction = actionKey;

      if (!verifying) focusSteps++;
      journal.push({
        n: run.steps.length + 1,
        agent: step.agent,
        did: step.action
          ? `${step.action.tool}(${JSON.stringify(step.action.args ?? {})})`
          : "spoke",
        saw: step.action ? resultLine(step.action.tool, result) : "",
        finding: step.finding?.id,
        question: step.question
          ? `${step.question.id}:${step.question.status}`
          : undefined
      });
      run.steps.push({ step, result });
      this.onEvent({
        type: "step",
        step,
        result,
        target: targetOf(this.index, step.action)
      });
      last = {
        agent: step.agent,
        action: step.action,
        result,
        finding: step.finding?.id ?? null,
        challenge: step.challenge?.text ?? null,
        note:
          repeats >= REPEAT_LIMIT - 1
            ? "You have repeated the same action. Use what you found and move on."
            : null
      };
      if (step.done) break;
    }

    if (!this.stopped && findings.length) {
      try {
        run.summary = groundSummary(
          await this.api.summarize({ findings }),
          this.index
        );
        this.onEvent({ type: "summary", summary: run.summary });
      } catch (error) {
        this.onEvent({ type: "error", error });
      }
    }
    run.findings = findings;
    run.questions = questions;
    this.onEvent({ type: "done", run });
    return run;
  }
}
