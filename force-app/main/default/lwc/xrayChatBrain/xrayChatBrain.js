import {
  CARDS,
  PLAIN,
  STORY_ORDER,
  STORY_GAP,
  TOPICS,
  QUESTIONS
} from "c/xrayDemoData";

/**
 * Demo-mode crew chat. Answers ONLY from findings already on the board.
 * Phase 3 replaces this with the Models API, under the same rule.
 */

const OPENERS = {
  ada: "Here is what I dug up. ",
  theo: "From my survey: ",
  pip: "That card is on the board. ",
  noor: "From the board: ",
  rex: "Checked it myself. "
};
const STORY_LEADS = {
  ada: "Here is the story so far, without the jargon. ",
  theo: "Ada tells it best, but here goes. ",
  pip: "From the cards I carried: ",
  noor: "Putting the board together: ",
  rex: "Only what we have proven: "
};
const NOT_YET = {
  ada: (q) => `I haven't dug there yet. It's on my list: "${q}"`,
  theo: (q) => `Not surveyed yet. Ada has it queued: "${q}"`,
  pip: () => "No card for that yet. I'll run it up as soon as Ada finds it.",
  noor: (q) => `Nothing on the board about that yet. Open question: "${q}"`,
  rex: () => "Nobody has proven that yet. Ask me again after the dig."
};

export function greeting(agent, foundCount) {
  return {
    ada: `Hi. I'm reading the org layer by layer. ${foundCount} findings so far. Ask me anything about them.`,
    theo: "Hello. I pegged out the objects. Ask me what this business is about.",
    pip: `Hey! I've carried ${foundCount} cards to the board. Want to know what's on it?`,
    noor: "Hi. I link the evidence and count things. Ask me how it fits together.",
    rex: "I doubt everything until it's proven. Ask me what we got wrong."
  }[agent];
}

/** Plain-words story built only from the findings on the board. */
export function storyText(found) {
  const have = STORY_ORDER.filter((id) => found.has(id));
  const missing = STORY_ORDER.filter((id) => !found.has(id));
  if (!have.length)
    return "I can't tell the story yet. Theo is still finding out what this business does.";
  let text = have.map((id) => PLAIN[id]).join(" ");
  if (missing.length)
    text += ` I'm still digging to find out ${missing.map((id) => STORY_GAP[id]).join(", ")}.`;
  return text;
}

/**
 * @param {string} agent crew key
 * @param {string} question visitor's question
 * @param {{found: Set<string>, style: 'plain'|'tech', activity: string, confidence: number, latest: string|null}} ctx
 * @returns {{text: string, source?: string}}
 */
export function reply(agent, question, ctx) {
  const s = question.toLowerCase();
  const found = ctx.found;
  const foundTitles = () =>
    [...found]
      .filter((id) => id !== "refundGuess")
      .map((id) => CARDS[id].title);

  if (/digging now|doing now|right now|what are you/.test(s))
    return { text: `${ctx.activity}.` };

  if (
    /plain words|layman|simple words|in simple|big picture|whole story|(explain|describe|tell me about|summari[sz]e) (the|this) (business|company)|how does (the|this) business/.test(
      s
    )
  ) {
    return {
      text: STORY_LEADS[agent] + storyText(found),
      source: "built only from the findings on the board"
    };
  }

  if (/board|so far|found|latest|on it/.test(s) && !/stuck/.test(s)) {
    const titles = foundTitles();
    if (!titles.length)
      return { text: "Nothing on the board yet. Give us a minute." };
    if (/latest/.test(s) && ctx.latest && TOPICS[ctx.latest]) {
      const body =
        ctx.style === "plain" ? PLAIN[ctx.latest] : TOPICS[ctx.latest].fact;
      return {
        text: `Latest: ${CARDS[ctx.latest].title}. ${body}`,
        source: TOPICS[ctx.latest].src
      };
    }
    return { text: `${titles.length} findings so far: ${titles.join("; ")}.` };
  }

  if (/wrong|mistake|correct/.test(s)) {
    return found.has("refund")
      ? {
          text: "One so far. Noor guessed Finance approves refunds, because Finance can edit the amount. Rex asked for proof. The approval goes to the Support Lead, so we struck the guess out.",
          source: "ApprovalProcess Case_Refund"
        }
      : { text: "Nothing proven wrong yet. Give it time." };
  }

  if (/sure|confiden/.test(s)) {
    return {
      text: `${ctx.confidence}% sure of the overall process right now. Each card says confirmed, likely or guess. Only the invoice step is "likely", because the accounting system is outside Salesforce.`
    };
  }

  if (/connect|fit|together|link/.test(s)) {
    return {
      text:
        foundTitles().length < 3
          ? "Not enough evidence yet to connect."
          : "The red strings show it: objects → sales stages → discount approval → order → shipping → invoice from the accounting system. Refunds are a side branch through Support."
    };
  }

  if (/matter most|important/.test(s)) {
    return {
      text: "Opportunity carries the most automation, then Case and Account. Shipment and Invoice tell me delivery and billing are part of the process."
    };
  }

  for (const [id, topic] of Object.entries(TOPICS)) {
    if (topic.kw.some((word) => s.includes(word))) {
      if (!found.has(id)) {
        const open = QUESTIONS.find((q) => q.id === topic.q)?.text ?? "";
        return { text: NOT_YET[agent](open) };
      }
      const opener =
        agent === "rex" && CARDS[id].status === "likely"
          ? "Only likely, not proven. "
          : OPENERS[agent];
      return ctx.style === "plain"
        ? {
            text: (agent === "rex" ? opener : "") + PLAIN[id],
            source: topic.src
          }
        : { text: opener + topic.fact, source: topic.src };
    }
  }

  const titles = foundTitles();
  return {
    text: `I can only answer from what we've found so far${titles.length ? `: ${titles.join("; ")}` : ""}. Try one of the suggestions.`
  };
}
