/**
 * Shared crew and audience settings. Investigation content (findings, process, story)
 * comes from a real run, not from this file.
 */

export const AGENTS = {
  ada: {
    name: "Ada",
    role: "Lead archaeologist · reads the metadata",
    color: "#c8743c"
  },
  theo: { name: "Theo", role: "Surveyor · maps the objects", color: "#3f7fbf" },
  pip: {
    name: "Pip",
    role: "Courier · carries findings to the board",
    color: "#e85d4a"
  },
  noor: {
    name: "Noor",
    role: "Analyst · links findings and counts",
    color: "#7b5cc4"
  },
  rex: {
    name: "Rex",
    role: "Skeptic · double-checks every claim",
    color: "#5b6b7a"
  }
};

export const ROLES = {
  dev: { label: "Developer", style: "tech" },
  po: { label: "Product owner", style: "plain" },
  user: { label: "Business user", style: "plain" }
};

export const GROUPS = [
  { id: "sell", label: "Sell" },
  { id: "approve", label: "Approve" },
  { id: "fulfil", label: "Fulfil" },
  { id: "bill", label: "Bill" },
  { id: "service", label: "Service" },
  { id: "other", label: "Other" }
];

export const SUGGESTIONS = {
  ada: [
    "Explain the business in plain words",
    "What are you digging now?",
    "Who approves things?"
  ],
  theo: ["What does this business sell?", "Which objects are the busiest?"],
  pip: ["What's on the board so far?", "What's the latest finding?"],
  noor: ["Where do things get stuck?", "How does it all connect?"],
  rex: ["What did you challenge?", "How sure are you?"]
};
