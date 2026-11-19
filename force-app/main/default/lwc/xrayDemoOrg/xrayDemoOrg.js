/**
 * Metadata index of the built-in demo org: Alder & Pine Outfitters (fictional).
 * Same shape as an index built from a visitor's uploaded metadata, so the crew,
 * the tools and the 3D world treat both the same way.
 *
 * objects:    [{ name, label, custom, records, fields, year }]
 * components: [{ name, type, object, year, active, detail }]
 * counts:     { "Object.Field": { value: count } }  aggregates only, never rows
 */
export const DEMO_ORG = {
  name: "Alder & Pine Outfitters",
  kind: "demo",
  objects: [
    {
      name: "Lead",
      label: "Lead",
      custom: false,
      records: 18420,
      fields: 61,
      year: 2015
    },
    {
      name: "Account",
      label: "Account",
      custom: false,
      records: 6210,
      fields: 88,
      year: 2015
    },
    {
      name: "Contact",
      label: "Contact",
      custom: false,
      records: 21904,
      fields: 54,
      year: 2015
    },
    {
      name: "Opportunity",
      label: "Opportunity",
      custom: false,
      records: 9882,
      fields: 97,
      year: 2015
    },
    {
      name: "Quote",
      label: "Quote",
      custom: false,
      records: 3140,
      fields: 46,
      year: 2017
    },
    {
      name: "Order",
      label: "Order",
      custom: false,
      records: 7006,
      fields: 52,
      year: 2017
    },
    {
      name: "Shipment__c",
      label: "Shipment",
      custom: true,
      records: 6930,
      fields: 23,
      year: 2016
    },
    {
      name: "Invoice__c",
      label: "Invoice",
      custom: true,
      records: 6874,
      fields: 19,
      year: 2015
    },
    {
      name: "Case",
      label: "Case",
      custom: false,
      records: 48115,
      fields: 71,
      year: 2015
    },
    {
      name: "Product2",
      label: "Product",
      custom: false,
      records: 412,
      fields: 33,
      year: 2015
    }
  ],
  components: [
    {
      name: "Opportunity.StageName",
      type: "picklist",
      object: "Opportunity",
      year: 2018,
      active: true,
      detail: {
        values: [
          "Prospecting",
          "Proposal",
          "Negotiation",
          "Closed Won",
          "Closed Lost"
        ]
      }
    },
    {
      name: "Opportunity_Sales_Path",
      type: "path",
      object: "Opportunity",
      year: 2018,
      active: true,
      detail: {
        field: "StageName",
        guidance: "Key fields and tips shown to reps at each stage"
      }
    },
    {
      name: "Case.Status",
      type: "picklist",
      object: "Case",
      year: 2016,
      active: true,
      detail: {
        values: ["New", "Working", "Waiting on Customer", "Escalated", "Closed"]
      }
    },
    {
      name: "Quote_Discount",
      type: "approval",
      object: "Quote",
      year: 2021,
      active: true,
      detail: {
        entryCriteria: "Discount__c > 20",
        approver: "Role: Sales Director",
        onApprove: "Status = Approved",
        runsThisYear: 214
      }
    },
    {
      name: "Case_Refund",
      type: "approval",
      object: "Case",
      year: 2021,
      active: true,
      detail: {
        entryCriteria: "Refund_Amount__c > 0",
        approver: "Role: Support Lead",
        onApprove: "Refund_Status__c = Approved",
        runsThisYear: 388
      }
    },
    {
      name: "Closed_Won_Handoff",
      type: "flow",
      object: "Opportunity",
      year: 2024,
      active: true,
      detail: {
        trigger: "Record-triggered, after save",
        entryCriteria: "StageName = 'Closed Won'",
        actions: [
          "Create Order from the Opportunity",
          "Copy Opportunity products to Order products"
        ]
      }
    },
    {
      name: "Lead_Routing",
      type: "flow",
      object: "Lead",
      year: 2022,
      active: true,
      detail: {
        trigger: "Record-triggered, before save",
        entryCriteria: "Created",
        actions: [
          "Set OwnerId from Region__c using the Region_Owner__mdt table"
        ]
      }
    },
    {
      name: "Account_Set_Tier",
      type: "flow",
      object: "Account",
      year: 2023,
      active: true,
      detail: {
        trigger: "Record-triggered, before save",
        actions: [
          "Set Tier__c from Won_Amount__c: Gold if >= 100000, Silver if >= 25000"
        ]
      }
    },
    {
      name: "OrderTrigger",
      type: "trigger",
      object: "Order",
      year: 2024,
      active: true,
      detail: {
        events: ["after insert", "after update"],
        handler: "OrderTriggerHandler"
      }
    },
    {
      name: "OrderTriggerHandler",
      type: "class",
      object: "Order",
      year: 2024,
      active: true,
      detail: {
        summary:
          "On activated Orders, creates one Shipment__c per Order and assigns it to the Warehouse queue",
        writes: ["Shipment__c"]
      }
    },
    {
      name: "CaseTrigger",
      type: "trigger",
      object: "Case",
      year: 2019,
      active: true,
      detail: { events: ["before insert"], handler: "CaseService" }
    },
    {
      name: "CaseService",
      type: "class",
      object: "Case",
      year: 2019,
      active: true,
      detail: {
        summary:
          "Links new Cases to the Account's entitlement and routes them to Support_Tier1"
      }
    },
    {
      name: "ErpSyncBatch",
      type: "batch",
      object: "Invoice__c",
      year: 2015,
      active: true,
      detail: {
        summary:
          "Nightly batch that calls the ERP and upserts Invoice__c by ERP_Invoice_Id__c",
        schedule: "Every day at 02:00",
        callout: "Named Credential ERP",
        writes: ["Invoice__c"]
      }
    },
    {
      name: "ERP",
      type: "namedCredential",
      object: null,
      year: 2015,
      active: true,
      detail: {
        endpoint: "https://erp.alderpine.example",
        usedBy: ["ErpSyncBatch"]
      }
    },
    {
      name: "Warehouse",
      type: "queue",
      object: "Shipment__c",
      year: 2016,
      active: true,
      detail: { members: "Warehouse team (12 users)", objects: ["Shipment__c"] }
    },
    {
      name: "Support_Tier1",
      type: "queue",
      object: "Case",
      year: 2016,
      active: true,
      detail: { members: "Support team (30 users)", objects: ["Case"] }
    },
    {
      name: "Finance",
      type: "permset",
      object: null,
      year: 2017,
      active: true,
      detail: {
        edit: ["Case.Refund_Amount__c"],
        read: ["Invoice__c", "Order"],
        note: "No approval permissions"
      }
    },
    {
      name: "Warehouse_Ops",
      type: "permset",
      object: null,
      year: 2016,
      active: true,
      detail: { edit: ["Shipment__c"], read: ["Order"] }
    },
    {
      name: "Closed_Won_Needs_PO",
      type: "validation",
      object: "Opportunity",
      year: 2021,
      active: true,
      detail: {
        rule: "StageName = 'Closed Won' AND ISBLANK(PO_Number__c)",
        message: "Add the customer's PO number before closing the deal."
      }
    },
    {
      name: "Quote_Max_Discount",
      type: "validation",
      object: "Quote",
      year: 2021,
      active: true,
      detail: {
        rule: "Discount__c > 40",
        message: "Discounts above 40% are not allowed."
      }
    },
    {
      name: "Opp_Old_Alerts",
      type: "processBuilder",
      object: "Opportunity",
      year: 2018,
      active: false,
      detail: { summary: "Retired in 2024 when Closed_Won_Handoff replaced it" }
    },
    {
      name: "Lead_Email_Alert",
      type: "workflow",
      object: "Lead",
      year: 2015,
      active: false,
      detail: { summary: "Inactive since 2019" }
    },
    {
      name: "LegacyQuotePdf",
      type: "vfpage",
      object: "Quote",
      year: 2021,
      active: false,
      detail: { summary: "No views in the last year" }
    },
    {
      name: "LegacyPriceUtil",
      type: "class",
      object: null,
      year: 2015,
      active: false,
      detail: {
        summary:
          "Not referenced by any trigger, flow or class; API version 19.0"
      }
    }
  ],
  counts: {
    "Opportunity.StageName": {
      Prospecting: 3120,
      Proposal: 2680,
      Negotiation: 1650,
      "Closed Won": 1940,
      "Closed Lost": 492
    },
    "Case.Status": {
      New: 2310,
      Working: 4104,
      "Waiting on Customer": 1980,
      Escalated: 640,
      Closed: 39081
    },
    "Lead.Status": {
      Open: 9210,
      Working: 4800,
      Converted: 3610,
      Unqualified: 800
    }
  }
};
