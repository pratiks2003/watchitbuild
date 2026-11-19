/**
 * Content for the built-in demo org: Alder & Pine Outfitters (fictional).
 * Captions and lens text use **bold** and `code` markup, rendered by c/xrayText.
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

/** Org layers by year. rows = voxel rows (0 = top). */
export const LAYERS = [
  {
    k: "2026",
    rows: [0, 1],
    color: "#c79d68",
    label: "Today",
    n: 140,
    nBig: 1210
  },
  {
    k: "2024",
    rows: [2, 3],
    color: "#b3844f",
    label: "2024 · flows era",
    n: 520,
    nBig: 4870,
    floor: -4
  },
  {
    k: "2021",
    rows: [4, 5],
    color: "#996a3c",
    label: "2021 · approvals",
    n: 610,
    nBig: 5320,
    floor: -6
  },
  {
    k: "2018",
    rows: [6, 7],
    color: "#7d5532",
    label: "2018 · Lightning",
    n: 470,
    nBig: 3912,
    floor: -8
  },
  {
    k: "2015",
    rows: [8, 9],
    color: "#5e3f26",
    label: "2015 · first build",
    n: 400,
    nBig: 3328,
    floor: -10
  }
];

/** Buried components. c = voxel column (0..23). Decoys are noted but not dug. */
export const ARTIFACTS = {
  a_stages: { layer: "2018", c: 13, title: "StageName + Path", icon: "≡" },
  a_discount: { layer: "2021", c: 17, title: "Quote_Discount", icon: "✓" },
  a_refund: { layer: "2021", c: 1, title: "Case_Refund", icon: "✓" },
  a_handoff: { layer: "2024", c: 10, title: "Closed_Won_Handoff", icon: "⟳" },
  a_ship: { layer: "2024", c: 18, title: "OrderTrigger", icon: "⚡" },
  a_erp: { layer: "2015", c: 15, title: "ErpSyncBatch", icon: "⇄" },
  d1: {
    layer: "2018",
    c: 20,
    title: "Process Builder · retired",
    icon: "⟳",
    decoy: true
  },
  d2: {
    layer: "2015",
    c: 21,
    title: "Workflow rule · inactive",
    icon: "⚑",
    decoy: true
  },
  d3: {
    layer: "2021",
    c: 22,
    title: "Visualforce page · unused",
    icon: "▢",
    decoy: true
  },
  d4: {
    layer: "2024",
    c: 22,
    title: "412 unused fields",
    icon: "∅",
    decoy: true
  }
};

export const FLAGS = [
  ["Lead", -10.5],
  ["Account", -8.4],
  ["Opportunity", -6.3],
  ["Quote", -4.2],
  ["Order", -2.1],
  ["Shipment__c", 0],
  ["Invoice__c", 2.1],
  ["Case", 4.2]
];

export const GROUPS = [
  { id: "sell", label: "Sell", more: 84 },
  { id: "approve", label: "Approve", more: 12 },
  { id: "fulfil", label: "Fulfil", more: 57 },
  { id: "bill", label: "Bill", more: 9 },
  { id: "service", label: "Service", more: 131 }
];

export const CARDS = {
  objects: {
    x: 2,
    y: 2,
    r: -2,
    group: "sell",
    by: "theo",
    type: "OBJECTS · THEO",
    title: "8 core objects",
    evidence:
      "Lead · Account · Opportunity · Quote · Order · Shipment__c · Invoice__c · Case",
    status: "confirmed"
  },
  stages: {
    x: 36,
    y: 1,
    r: 1.5,
    group: "sell",
    by: "ada",
    type: "PICKLIST + PATH · 2018",
    title: "Four sales stages",
    evidence: "Prospecting → Proposal → Negotiation → Closed Won",
    status: "confirmed"
  },
  discount: {
    x: 70,
    y: 3,
    r: -1,
    group: "approve",
    by: "ada",
    type: "APPROVAL · 2021",
    title: "Discounts over 20% → Sales Director",
    evidence: "Quote_Discount · active · used 214 times this year",
    status: "confirmed"
  },
  handoff: {
    x: 3,
    y: 36,
    r: 1,
    group: "fulfil",
    by: "ada",
    type: "FLOW · 2024",
    title: "A won deal creates an Order",
    evidence: "After-save flow Closed_Won_Handoff",
    status: "confirmed"
  },
  ship: {
    x: 37,
    y: 37,
    r: -1.5,
    group: "fulfil",
    by: "ada",
    type: "TRIGGER + QUEUE · 2024",
    title: "Warehouse ships the order",
    evidence: "OrderTrigger creates Shipment__c for the Warehouse queue",
    status: "confirmed"
  },
  refundGuess: {
    x: 70,
    y: 36,
    r: 2,
    group: "service",
    by: "noor",
    type: "GUESS · NOOR",
    title: "Finance approves refunds?",
    evidence: "Finance can edit Case.Refund_Amount__c",
    status: "guess"
  },
  refund: {
    x: 70,
    y: 69,
    r: -2,
    group: "service",
    by: "ada",
    type: "APPROVAL · 2021",
    title: "Refunds → Support Lead",
    evidence: "Case_Refund routes to the Support Lead role",
    status: "confirmed"
  },
  erp: {
    x: 3,
    y: 69,
    r: -1,
    group: "bill",
    by: "ada",
    type: "INTEGRATION · 2015",
    title: "Invoices come from the ERP",
    evidence:
      "ErpSyncBatch writes Invoice__c nightly · Finance is read-only here",
    status: "likely"
  },
  drop: {
    x: 37,
    y: 70,
    r: 1.5,
    group: "sell",
    by: "noor",
    type: "COUNTS ONLY · NOOR",
    title: "38% of deals stall at Proposal",
    evidence: "COUNT() GROUP BY StageName · no records copied",
    status: "confirmed"
  }
};

export const STRINGS = [
  ["objects", "stages"],
  ["stages", "discount"],
  ["stages", "handoff"],
  ["handoff", "ship"],
  ["ship", "erp"],
  ["refundGuess", "refund"],
  ["stages", "drop"]
];

export const QUESTIONS = [
  {
    id: "q1",
    text: "What does this business sell, and to whom?",
    answer: "Outdoor gear, sold to lodges and shops"
  },
  {
    id: "q2",
    text: "What are the sales steps?",
    answer: "4 stages, with a Path"
  },
  {
    id: "q3",
    text: "Who approves discounts?",
    answer: "Sales Director, over 20%"
  },
  {
    id: "q6",
    text: "Who approves refunds?",
    answer: "Support Lead, not Finance"
  },
  {
    id: "q4",
    text: "What happens after a deal is won?",
    answer: "An Order is created automatically"
  },
  { id: "q5", text: "Who ships the order?", answer: "Warehouse queue" },
  {
    id: "q7",
    text: "Who sends the invoice?",
    answer: "The ERP, synced nightly (likely)"
  },
  { id: "q8", text: "Where do deals get stuck?", answer: "Proposal: 38% stall" }
];

/** Plain-words version of each finding: no Salesforce terms. */
export const PLAIN = {
  objects:
    "Alder & Pine sells outdoor gear, like tents, to lodges and shops. Everything in the system is about those customers, their deals, orders, deliveries, bills and support requests.",
  stages:
    "A salesperson takes each deal through four steps: first contact, a written offer, agreeing the price, then a signed deal. The screen shows them which step comes next.",
  drop: "About 4 in 10 deals go quiet after the written offer. That is where the business loses the most customers.",
  discount:
    "If a salesperson wants to give more than 20% off, the sales boss has to say yes first. This happens a lot: 214 times this year.",
  handoff:
    "Once a deal is signed, the order is created automatically. Nobody types it in again.",
  ship: "The order then lands on the warehouse team's to-do list, and they ship it.",
  erp: "The bill is not made in this system. A separate accounting system sends it overnight. I'm fairly sure, but I can't see inside that other system.",
  refund:
    "If a customer wants money back, the support team leader approves it. Finance can change the amount, but they don't decide."
};

export const STORY_ORDER = [
  "objects",
  "stages",
  "drop",
  "discount",
  "handoff",
  "ship",
  "erp",
  "refund"
];
export const STORY_GAP = {
  objects: "what the business sells",
  stages: "how a sale works",
  drop: "where customers drop off",
  discount: "who approves discounts",
  handoff: "what happens after a sale",
  ship: "who delivers the goods",
  erp: "who sends the bill",
  refund: "how refunds work"
};

/** Technical facts and sources, used by the chat in "Technical" style. */
export const TOPICS = {
  objects: {
    kw: ["sell", "business", "customer", "object", "who buys", "what does"],
    q: "q1",
    fact: "This business sells outdoor gear to lodges and shops. The 8 core objects are Lead, Account, Opportunity, Quote, Order, Shipment__c, Invoice__c and Case.",
    src: "Object list + record counts"
  },
  stages: {
    kw: ["stage", "pipeline", "sales step", "path", "2018", "steps"],
    q: "q2",
    fact: "Deals move through four stages: Prospecting, Proposal, Negotiation, Closed Won. A Path on Opportunity guides reps through them. Built in 2018.",
    src: "Opportunity.StageName · PathAssistant"
  },
  discount: {
    kw: ["discount", "director", "quote approv"],
    q: "q3",
    fact: "Any discount over 20% needs the Sales Director. The approval process Quote_Discount is active and ran 214 times this year.",
    src: "ApprovalProcess Quote_Discount · count only"
  },
  refund: {
    kw: ["refund", "support lead", "finance approv"],
    q: "q6",
    fact: "Refunds are approved by the Support Lead through Case_Refund. Finance can edit the amount, but does not approve it. We first guessed Finance and corrected it.",
    src: "ApprovalProcess Case_Refund · Finance permission set"
  },
  handoff: {
    kw: [
      "won",
      "after a deal",
      "order created",
      "closed",
      "handoff",
      "2024",
      "signed"
    ],
    q: "q4",
    fact: "When a deal is Closed Won, the after-save flow Closed_Won_Handoff creates an Order automatically.",
    src: "Flow Closed_Won_Handoff v4"
  },
  ship: {
    kw: ["ship", "warehouse", "deliver", "fulfil"],
    q: "q5",
    fact: "OrderTrigger creates a Shipment__c record and puts it in the Warehouse queue.",
    src: "OrderTrigger.trigger · Queue Warehouse"
  },
  erp: {
    kw: ["invoice", "erp", "bill", "integration", "2015", "accounting"],
    q: "q7",
    fact: 'Invoices are not made in Salesforce. ErpSyncBatch, built in 2015, writes Invoice__c every night from the ERP. I call this "likely", because the ERP itself is outside what I can see.',
    src: "ErpSyncBatch.cls · Named Credential ERP"
  },
  drop: {
    kw: ["stuck", "stall", "drop", "slow", "convert", "lose"],
    q: "q8",
    fact: "38% of deals stall at Proposal. That comes from counting deals by stage. No records were copied.",
    src: "COUNT() GROUP BY StageName"
  }
};

export const SUGGESTIONS = {
  ada: [
    "Explain the business in plain words",
    "What are you digging now?",
    "Who approves discounts?"
  ],
  theo: ["What does this business sell?", "Which objects matter most?"],
  pip: ["What's on the board so far?", "What's the latest finding?"],
  noor: [
    "Where do deals get stuck?",
    "How does it all connect?",
    "Who approves refunds?"
  ],
  rex: ["What did the crew get wrong?", "How sure are you?"]
};

/** "What this means for you", per role. */
export const LENS = {
  dev: {
    title: "Where the logic lives",
    items: [
      "Sales stages: `Opportunity.StageName` + Path",
      "Discount gate: approval process `Quote_Discount`",
      "Order creation: after-save flow `Closed_Won_Handoff`",
      "Shipping: `OrderTrigger` → `Shipment__c` → queue Warehouse",
      "Invoices: `ErpSyncBatch` (nightly, Named Credential ERP) writes `Invoice__c`",
      "Refunds: approval process `Case_Refund`",
      "**Risk:** the flow and `OrderTrigger` both act on Order. Check their order of execution before changing either."
    ]
  },
  po: {
    title: "What a product owner should look at",
    items: [
      "**Biggest leak:** 38% of deals stall at the written offer.",
      "**Approval load:** 214 discount approvals this year. Is 20% the right line, or is it slowing deals down?",
      "**Blind spot:** invoices live in the accounting system, so sales can't see if a customer has paid.",
      "**Ownership:** refunds belong to Support, not Finance, even though Finance can edit amounts.",
      "**Confidence:** 7 of 9 steps confirmed from the system itself."
    ]
  },
  user: {
    title: "What happens when you…",
    items: [
      "**…sign a deal?** The order is created for you and goes to the warehouse.",
      "**…offer more than 20% off?** Your sales director gets a request to approve it first.",
      "**…get a refund request?** Pass it to support. Their team leader approves it.",
      "**…look for an invoice?** It comes from the accounting system overnight, not from here."
    ]
  }
};

/** "I'm new here" cheat sheets: technical for developers, business steps for everyone else. */
export const NEW_HERE = {
  tech: {
    title: "New developer cheat sheet",
    items: [
      "**Org shape:** 8 core objects. The busiest is `Opportunity`.",
      "**Automation chain:** Path → `Quote_Discount` → `Closed_Won_Handoff` → `OrderTrigger` → `ErpSyncBatch`",
      "**Read first:** `OrderTrigger` and the `Closed_Won_Handoff` flow together; they both act on Order.",
      "**Outside Salesforce:** invoices come from the ERP via `ErpSyncBatch` and Named Credential `ERP`.",
      "**Glossary:** approval process = record lock + routing to an approver; queue = shared owner for a team.",
      "**Who owns what:** Sales Director owns discounts over 20%; Support Lead owns refunds."
    ]
  },
  biz: {
    title: "Your first-week business steps",
    items: [
      "**1. A lead comes in** from the web form.",
      "**2. Sales works the deal:** written offer → price talks → signed.",
      "**3. Over 20% off?** The Sales Director approves first.",
      "**4. Signed deal:** the order is created automatically and the warehouse ships it.",
      "**5. The invoice** comes from the accounting system overnight.",
      "**6. A refund?** The Support Lead approves it.",
      "**Words:** Opportunity = a deal · Quote = the written offer · Queue = a team's to-do list"
    ]
  }
};

export const LANES = [
  "Customer",
  "Sales",
  "Sales Director",
  "Warehouse",
  "ERP · Finance",
  "Support"
];

/** Swimlane steps: [lane, x, label, evidence, confirmed|likely]. */
export const PROCESS_NODES = [
  [0, 230, "Enquiry", "web form → Lead", "c"],
  [1, 370, "Lead qualified", "Lead Path", "c"],
  [1, 520, "Offer → Negotiate", "38% stall here", "c"],
  [2, 670, "Approve > 20% off", "Quote_Discount", "c"],
  [1, 820, "Closed Won", "Opportunity", "c"],
  [3, 970, "Order + Shipment", "Flow + OrderTrigger", "c"],
  [4, 1120, "Invoice sent", "ERP, nightly sync", "l"],
  [0, 1270, "Goods + invoice", "end of main path", "c"],
  [5, 1270, "Refund approved", "Case_Refund", "c"]
];

export const PROCESS_CAPTIONS = [
  "**Maya from Summit Lodge** fills in the web form. A Lead is created.",
  "Sales qualifies her. The Lead becomes a deal.",
  "A written offer, then price talks. This is where 4 in 10 deals stall.",
  "She asks for 25% off. That is over 20%, so the **Sales Director** must approve.",
  "Approved. The deal is signed.",
  "The order is created by itself and lands on the **Warehouse** list.",
  "The **accounting system** sends the invoice overnight. This step is outside Salesforce.",
  "Maya gets 40 tents and her invoice."
];
export const PROCESS_BRANCH =
  "**Branch.** If Maya asks for a refund later, the case goes to the **Support Lead** for approval.";
