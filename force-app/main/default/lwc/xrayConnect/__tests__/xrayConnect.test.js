import {
  cleanDomain,
  redirectUri,
  readOrg,
  layeringFor,
  CLIENT_ID
} from "c/xrayConnect";

const ok = (body) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve(body)
});
const fail = (status, message) => ({
  ok: false,
  status,
  json: () => Promise.resolve([{ message }])
});
const rows = (records) => ok({ records, done: true });

/** A tiny fake org answering the REST and Tooling calls readOrg makes. */
function fakeOrg(url) {
  const path = decodeURIComponent(
    url.replace("https://acme.my.salesforce.com", "")
  );
  if (path.includes("FROM Organization")) return rows([{ Name: "Acme Bikes" }]);
  if (path.endsWith("/sobjects"))
    return ok({
      sobjects: [
        {
          name: "Opportunity",
          label: "Opportunity",
          custom: false,
          queryable: true
        },
        { name: "Case", label: "Case", custom: false, queryable: true },
        { name: "Repair__c", label: "Repair", custom: true, queryable: true },
        { name: "Setup__Share", label: "x", custom: false, queryable: true }
      ]
    });
  if (path.includes("/limits/recordCount"))
    return ok({ sObjects: [{ name: "Opportunity", count: 120 }] });
  if (path.includes("SELECT Metadata FROM Flow"))
    return rows([
      {
        Metadata: {
          label: "Repair Intake",
          start: {
            object: "Repair__c",
            triggerType: "RecordAfterSave",
            recordTriggerType: "Create",
            filters: [
              {
                field: "Status__c",
                operator: "EqualTo",
                value: { stringValue: "New" }
              }
            ]
          },
          recordCreates: [{ object: "Task" }]
        }
      }
    ]);
  if (path.includes("FROM Flow"))
    return rows([
      {
        Id: "301A",
        Definition: { DeveloperName: "Repair_Intake" },
        ProcessType: "AutoLaunchedFlow",
        CreatedDate: "2025-03-01T00:00:00Z"
      }
    ]);
  if (path.includes("FROM ApexTrigger"))
    return rows([
      {
        Name: "CaseTrigger",
        Status: "Active",
        CreatedDate: "2019-05-01T00:00:00Z",
        Body: "trigger CaseTrigger on Case (before insert) { CaseHandler.run(); }"
      }
    ]);
  if (path.includes("FROM ApexClass")) return fail(403, "No access to Apex");
  if (path.includes("FROM ValidationRule"))
    return rows([
      {
        ValidationName: "Need_Reason",
        Active: true,
        ErrorMessage: "Add a reason",
        CreatedDate: "2022-01-01T00:00:00Z",
        EntityDefinition: { QualifiedApiName: "Case" }
      }
    ]);
  if (path.includes("/sobjects/Opportunity/describe"))
    return ok({
      fields: [
        {
          name: "StageName",
          picklistValues: [
            { value: "Prospect", active: true },
            { value: "Old", active: false }
          ]
        }
      ]
    });
  if (path.includes("/describe")) return ok({ fields: [] });
  if (path.includes("GROUP BY StageName"))
    return rows([{ v: "Prospect", n: 7 }]);
  return rows([]);
}

describe("c/xrayConnect", () => {
  it("has a real client id baked in", () => {
    expect(CLIENT_ID).toMatch(/^3MVG/);
  });

  it("accepts only Salesforce login hosts", () => {
    expect(cleanDomain("https://Acme.my.salesforce.com/home")).toBe(
      "acme.my.salesforce.com"
    );
    expect(cleanDomain("acme--uat.sandbox.my.salesforce.com")).toBe(
      "acme--uat.sandbox.my.salesforce.com"
    );
    expect(cleanDomain("login.salesforce.com")).toBeNull();
    expect(cleanDomain("evil.example.com")).toBeNull();
    expect(cleanDomain("acme.my.salesforce.com.evil.io")).toBeNull();
    expect(cleanDomain("")).toBeNull();
  });

  it("returns to the site's home page", () => {
    expect(
      redirectUri({
        origin: "https://x.my.site.com",
        pathname: "/watchitbuild/"
      })
    ).toBe("https://x.my.site.com/watchitbuild/");
  });

  it("reads an org into an index, skipping what it cannot see", async () => {
    const seen = [];
    const fetchImpl = jest.fn((url, init) => {
      expect(init.headers.Authorization).toBe("Bearer T");
      return Promise.resolve(fakeOrg(url));
    });
    const index = await readOrg(
      { token: "T", instanceUrl: "https://acme.my.salesforce.com" },
      { fetchImpl, onProgress: (p) => seen.push(p) }
    );
    expect(index.name).toBe("Acme Bikes");
    expect(index.kind).toBe("live");
    expect(index.objects.map((o) => o.name).sort()).toEqual([
      "Case",
      "Opportunity",
      "Repair__c"
    ]);
    expect(index.objects.find((o) => o.name === "Opportunity").records).toBe(
      120
    );

    const flow = index.components.find((c) => c.name === "Repair_Intake");
    expect(flow).toMatchObject({
      type: "flow",
      object: "Repair__c",
      year: 2025
    });
    expect(flow.detail.trigger).toContain("after save");
    expect(flow.detail.entryCriteria).toContain("Status__c EqualTo New");
    expect(flow.detail.actions).toContain("Create Task");

    expect(
      index.components.find((c) => c.name === "CaseTrigger")
    ).toMatchObject({ type: "trigger", object: "Case", year: 2019 });
    expect(
      index.components.find((c) => c.name === "Opportunity.StageName").detail
        .values
    ).toEqual(["Prospect"]);
    expect(index.counts["Opportunity.StageName"]).toEqual({ Prospect: 7 });
    expect(index.stats.skipped.join(" ")).toContain("No access to Apex");
    expect(index.layering).toBe("year");
    expect(seen).toContain("Reading flows");
  });

  it("layers a young org by kind", () => {
    expect(layeringFor([{ year: 2025 }, { year: 2026 }, { year: null }])).toBe(
      "kind"
    );
    expect(layeringFor([{ year: 2025 }, { year: 2016 }])).toBe("year");
  });
});
