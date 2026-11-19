import { buildIndex } from "c/xrayIndexer";
import { buildLayout } from "c/xrayLayout";

const NS = 'xmlns="http://soap.sforce.com/2006/04/metadata"';
const P = "unpackaged";

const FILES = {
  [`${P}/objects/Opportunity.object`]: `<?xml version="1.0"?><CustomObject ${NS}>
    <compactLayouts><fullName>X</fullName><label>Not the object label</label></compactLayouts>
    <fields><fullName>Region__c</fullName><type>Picklist</type><valueSet><valueSetDefinition>
      <value><fullName>North</fullName></value><value><fullName>South</fullName></value></valueSetDefinition></valueSet></fields>
    <fields><fullName>PO_Number__c</fullName><type>Text</type></fields>
    <label>Opportunity</label>
    <validationRules><fullName>Closed_Won_Needs_PO</fullName><active>true</active>
      <errorConditionFormula>ISPICKVAL(StageName,'Closed Won') &amp;&amp; ISBLANK(PO_Number__c)</errorConditionFormula>
      <errorMessage>Add the PO number.</errorMessage></validationRules>
  </CustomObject>`,
  [`${P}/objects/Shipment__c.object`]: `<CustomObject ${NS}><label>Shipment</label><fields><fullName>Carrier__c</fullName><type>Text</type></fields></CustomObject>`,
  [`${P}/standardValueSets/OpportunityStage.standardValueSet`]: `<StandardValueSet ${NS}>
    <standardValue><fullName>Prospecting</fullName></standardValue><standardValue><fullName>Closed Won</fullName></standardValue></StandardValueSet>`,
  [`${P}/flows/Closed_Won_Handoff.flow`]: `<Flow ${NS}><label>Closed Won Handoff</label><processType>AutoLaunchedFlow</processType>
    <recordCreates><name>Make_Order</name><object>Order</object></recordCreates>
    <actionCalls><name>Notify</name><actionName>chatterPost</actionName><actionType>chatterPost</actionType></actionCalls>
    <start><object>Opportunity</object><recordTriggerType>Update</recordTriggerType><triggerType>RecordAfterSave</triggerType>
      <filters><field>StageName</field><operator>EqualTo</operator><value><stringValue>Closed Won</stringValue></value></filters></start>
    <status>Active</status></Flow>`,
  [`${P}/flows/Old_PB.flow`]: `<Flow ${NS}><processType>Workflow</processType><status>Obsolete</status></Flow>`,
  [`${P}/triggers/OrderTrigger.trigger`]: `trigger OrderTrigger on Order (after insert, after update) {\n  OrderTriggerHandler.afterSave(Trigger.new);\n}`,
  [`${P}/triggers/OrderTrigger.trigger-meta.xml`]: `<ApexTrigger ${NS}><status>Active</status></ApexTrigger>`,
  [`${P}/classes/ErpSyncBatch.cls`]: `/** Nightly sync of invoices from the ERP. */\npublic class ErpSyncBatch implements Database.Batchable<SObject>, Schedulable {\n  void go(){ HttpRequest r = new HttpRequest(); r.setEndpoint('callout:ERP/invoices'); Shipment__c s = new Shipment__c(); }\n}`,
  [`${P}/classes/ErpSyncBatchTest.cls`]: `@isTest\nprivate class ErpSyncBatchTest {}`,
  [`${P}/approvalProcesses/Quote.Quote_Discount.approvalProcess`]: `<ApprovalProcess ${NS}><active>true</active><label>Quote Discount</label>
    <entryCriteria><criteriaItems><field>Quote.Discount__c</field><operation>greaterThan</operation><value>20</value></criteriaItems></entryCriteria>
    <approvalStep><assignedApprover><approver><name>Sales_Director</name><type>role</type></approver></assignedApprover></approvalStep>
  </ApprovalProcess>`,
  [`${P}/namedCredentials/ERP.namedCredential`]: `<NamedCredential ${NS}><endpoint>https://erp.example.com</endpoint><label>ERP</label></NamedCredential>`,
  [`${P}/queues/Warehouse.queue`]: `<Queue ${NS}><name>Warehouse</name><queueSobject><sobjectType>Shipment__c</sobjectType></queueSobject></Queue>`,
  [`${P}/permissionsets/Finance.permissionset`]: `<PermissionSet ${NS}><label>Finance</label>
    <fieldPermissions><editable>true</editable><field>Case.Refund_Amount__c</field></fieldPermissions>
    <objectPermissions><allowEdit>false</allowEdit><object>Invoice__c</object></objectPermissions></PermissionSet>`,
  [`${P}/permissionsets/ReadOnly.permissionset`]: `<PermissionSet ${NS}><label>Read only</label><objectPermissions><allowEdit>false</allowEdit><object>Account</object></objectPermissions></PermissionSet>`,
  [`${P}/pathAssistants/Opp_Path.pathAssistant`]: `<PathAssistant ${NS}><active>true</active><entityName>Opportunity</entityName><fieldName>StageName</fieldName></PathAssistant>`,
  [`${P}/workflows/Lead.workflow`]: `<Workflow ${NS}><rules><fullName>Lead_Alert</fullName><active>false</active><formula>true</formula></rules></Workflow>`,
  [`${P}/flows/Broken.flow`]: `<Flow ${NS}><unclosed>`
};

const index = buildIndex(FILES);
const get = (name) => index.components.find((c) => c.name === name);

describe("c/xrayIndexer", () => {
  it("reads objects with their real label, field count and no record counts", () => {
    const opp = index.objects.find((o) => o.name === "Opportunity");
    expect(opp).toMatchObject({
      label: "Opportunity",
      fields: 2,
      records: null,
      custom: false
    });
    expect(index.objects.find((o) => o.name === "Shipment__c").custom).toBe(
      true
    );
  });

  it("reads custom picklists, standard value sets and validation rules", () => {
    expect(get("Opportunity.Region__c").detail.values).toEqual([
      "North",
      "South"
    ]);
    expect(get("Opportunity.StageName").detail.values).toEqual([
      "Prospecting",
      "Closed Won"
    ]);
    expect(get("Closed_Won_Needs_PO")).toMatchObject({
      type: "validation",
      object: "Opportunity",
      active: true
    });
    expect(get("Closed_Won_Needs_PO").detail.rule).toContain(
      "ISBLANK(PO_Number__c)"
    );
  });

  it("reads a record-triggered flow: trigger, filter and actions", () => {
    const flow = get("Closed_Won_Handoff");
    expect(flow).toMatchObject({
      type: "flow",
      object: "Opportunity",
      active: true
    });
    expect(flow.detail.trigger).toBe("Record-triggered, after save (Update)");
    expect(flow.detail.entryCriteria).toBe("StageName EqualTo Closed Won");
    expect(flow.detail.actions).toEqual([
      "Create Order",
      "chatterPost: chatterPost"
    ]);
    expect(get("Old_PB")).toMatchObject({
      type: "processBuilder",
      active: false
    });
  });

  it("reads triggers and classes, skipping test classes", () => {
    expect(get("OrderTrigger")).toMatchObject({
      type: "trigger",
      object: "Order",
      active: true
    });
    expect(get("OrderTrigger").detail).toMatchObject({
      events: ["after insert", "after update"],
      handler: "OrderTriggerHandler"
    });
    const batch = get("ErpSyncBatch");
    expect(batch.type).toBe("batch");
    expect(batch.detail).toMatchObject({
      kinds: ["batch", "schedulable"],
      callout: "Named Credential ERP",
      writes: ["Shipment__c"],
      summary: "Nightly sync of invoices from the ERP."
    });
    expect(get("ErpSyncBatchTest")).toBeUndefined();
  });

  it("reads approvals, credentials, queues, permission sets, paths and workflow rules", () => {
    expect(get("Quote_Discount")).toMatchObject({
      type: "approval",
      object: "Quote",
      active: true
    });
    expect(get("Quote_Discount").detail).toMatchObject({
      entryCriteria: "Quote.Discount__c greaterThan 20",
      approver: "role: Sales_Director"
    });
    expect(get("ERP").detail.endpoint).toBe("https://erp.example.com");
    expect(get("Warehouse")).toMatchObject({
      type: "queue",
      object: "Shipment__c"
    });
    expect(get("Finance").detail.editFields).toEqual(["Case.Refund_Amount__c"]);
    expect(get("ReadOnly")).toBeUndefined();
    expect(get("Opp_Path")).toMatchObject({
      type: "path",
      object: "Opportunity"
    });
    expect(get("Lead_Alert")).toMatchObject({
      type: "workflow",
      active: false
    });
  });

  it("counts unreadable files instead of failing, and has no counts or years", () => {
    expect(index.stats.unreadable).toBe(1);
    expect(index.counts).toEqual({});
    expect(index.components.every((c) => c.year === null)).toBe(true);
  });

  it("layers an uploaded org by kind, with honest labels", () => {
    const layout = buildLayout(index);
    expect(layout.byKind).toBe(true);
    expect(layout.layers.map((l) => l.label)).toEqual([
      "Objects",
      "Automation",
      "Rules and steps",
      "Code",
      "Access and integration"
    ]);
    expect(layout.artifacts.Closed_Won_Handoff.layer).toBe("recent");
    expect(layout.artifacts.Quote_Discount.layer).toBe("mid");
    expect(layout.artifacts.ErpSyncBatch.layer).toBe("older");
    expect(layout.artifacts.ERP.layer).toBe("oldest");
    expect(layout.flags[0][0]).toBe("Opportunity");
  });
});
