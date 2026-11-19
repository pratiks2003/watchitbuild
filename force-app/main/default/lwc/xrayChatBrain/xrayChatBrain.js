/**
 * Crew chat without a model call: answers ONLY from the findings on the board,
 * Rex's challenges and Ada's summary. Phase 3 adds model-written answers under the
 * same rule; this stays as the fallback when the live crew is off.
 *
 * ctx: { findings: [{ finding, agent }], summary, challenges: string[], style: 'plain'|'tech',
 *        activity, confidence }
 */

const STOP = new Set([
  "what",
  "does",
  "this",
  "that",
  "with",
  "from",
  "they",
  "their",
  "there",
  "where",
  "when",
  "which",
  "about",
  "tell",
  "have",
  "into",
  "your",
  "you",
  "the",
  "and",
  "who",
  "how",
  "are",
  "for",
  "any",
  "things"
]);

/** Lowercase word set with light stemming, so "invoice", "Invoices" and "Invoice__c" all match. */
function stem(w) {
  return w.length > 4 && w.endsWith("s") && !w.endsWith("ss")
    ? w.slice(0, -1)
    : w;
}
const words = (text) =>
  new Set(
    String(text ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map(stem)
  );

const OPENERS = {
  ada: "Here is what I dug up. ",
  theo: "From my survey: ",
  pip: "That card is on the board. ",
  noor: "From the board: ",
  rex: "Checked it myself. "
};
const STORY_LEADS = {
  ada: "Here is the story, without the jargon. ",
  theo: "Ada tells it best, but here goes. ",
  pip: "From the cards I carried: ",
  noor: "Putting the board together: ",
  rex: "Only what we have shown: "
};

export function greeting(agent, count) {
  return {
    ada: `Hi. I'm reading the org layer by layer. ${count} findings so far. Ask me anything about them.`,
    theo: "Hello. I pegged out the objects. Ask me what this business is about.",
    pip: `Hey! I've carried ${count} cards to the board. Want to know what's on it?`,
    noor: "Hi. I link the evidence and count things. Ask me how it fits together.",
    rex: "I doubt everything until it's shown. Ask me what I challenged."
  }[agent];
}

/** Plain-words story: Ada's summary if the run finished, else the findings so far. */
export function storyText(findings, summary) {
  if (summary?.story?.length) return summary.story.join(" ");
  if (!findings.length)
    return "I can't tell the story yet. Theo is still finding out what this business does.";
  return `${findings.map(({ finding }) => finding.plain).join(" ")} We're still digging, so there's more to come.`;
}

/** Best-matching finding for a question, by shared words. */
export function bestFinding(question, findings) {
  const q = words(question);
  let best = null;
  let bestScore = 0;
  findings.forEach((entry) => {
    const f = entry.finding;
    const text = words(
      `${f.title} ${f.plain} ${f.evidence} ${f.source} ${f.id.replace(/_/g, " ")}`
    );
    let score = 0;
    q.forEach((w) => {
      if (text.has(w)) score += 1;
    });
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  });
  return best;
}

export function reply(agent, question, ctx) {
  const s = question.toLowerCase();
  const findings = ctx.findings ?? [];
  const titles = () => findings.map(({ finding }) => finding.title);

  if (/digging now|doing now|right now|what are you/.test(s))
    return { text: `${ctx.activity || "Waiting for the next job"}.` };

  if (
    /plain words|layman|simple words|in simple|big picture|whole story|(explain|describe|summari[sz]e) (the|this) (business|company)|how does (the|this) business/.test(
      s
    )
  ) {
    return {
      text: STORY_LEADS[agent] + storyText(findings, ctx.summary),
      source: "built only from the findings on the board"
    };
  }

  if (/challeng|wrong|mistake|doubt/.test(s)) {
    const challenges = ctx.challenges ?? [];
    if (!challenges.length)
      return { text: "I haven't challenged anything yet. Give it time." };
    return {
      text: `I challenged ${challenges.length} finding${challenges.length > 1 ? "s" : ""}: ${challenges.map((c) => `"${c}"`).join(" ")} Each time the crew had to look at something new before the card could stay.`
    };
  }

  if (/sure|confiden|certain/.test(s)) {
    const n = (c) =>
      findings.filter(({ finding }) => finding.confidence === c).length;
    return {
      text: `${ctx.confidence ?? 0}% sure of the whole picture. ${n("confirmed")} findings are confirmed, ${n("likely")} likely and ${n("guess")} guesses. Likely means we saw strong signs but could not see inside, for example another system.`
    };
  }

  if (/board|so far|latest|on it/.test(s) && !/stuck/.test(s)) {
    if (!findings.length)
      return { text: "Nothing on the board yet. Give us a minute." };
    if (/latest/.test(s)) {
      const { finding } = findings[findings.length - 1];
      return {
        text: `Latest: ${finding.title}. ${ctx.style === "plain" ? finding.plain : finding.evidence}`,
        source: finding.source
      };
    }
    return {
      text: `${findings.length} findings so far: ${titles().join("; ")}.`
    };
  }

  if (/connect|fit|together|link/.test(s)) {
    if (findings.length < 3)
      return { text: "Not enough evidence yet to connect." };
    const steps = ctx.summary?.process?.steps?.map((p) => p.label);
    return {
      text: steps?.length
        ? `In order: ${steps.join(" → ")}.`
        : `In the order we found them: ${titles().join(" → ")}.`
    };
  }

  const match = bestFinding(question, findings);
  if (match) {
    const f = match.finding;
    if (agent === "rex") {
      const opener =
        f.confidence === "confirmed"
          ? "Shown, I checked. "
          : "Only likely, not fully shown. ";
      return {
        text: opener + (ctx.style === "plain" ? f.plain : f.evidence),
        source: f.source
      };
    }
    return ctx.style === "plain"
      ? { text: f.plain, source: f.source }
      : { text: OPENERS[agent] + f.evidence, source: f.source };
  }

  return {
    text: findings.length
      ? `I can only answer from what we've found so far: ${titles().join("; ")}. Try one of the suggestions.`
      : "We haven't found anything yet, so I can't answer that. Ask me again in a minute."
  };
}
