import { describe, expect, it } from "vitest";
import { hashJson } from "../../application/plane-export-payload.js";
import type { PlaneCreateRequest } from "../../application/plane-provider-port.js";
import { planeCreateFields } from "./fields.js";
import { planeKnownItemObservation } from "./known-item-observation.js";
import { planeManagedContent } from "./managed-content.js";

function fixture() {
  const payload = { schema_version: 1, owner: { type: "ticket", id: "ticket" }, source_ticket_revision_id: "current-revision",
    specification: { title: "名稱 <title>", user_story: "<script> & '引號'\n下一行", scope: ["範圍"],
      acceptance_criteria: [{ id: "AC-1", text: "成功" }], non_goals: [] } };
  const expected: PlaneCreateRequest = { container: { id: "container", provider: "plane", workspaceIdentity: "workspace",
    containerIdentity: "project", displayName: null, createdAt: "2026-09-27T00:00:00Z", updatedAt: "2026-09-27T00:00:00Z" },
    idempotencyKey: "original-create-key", payload, payloadHash: hashJson(payload) };
  const request = { container: expected.container, externalId: "stored-item" };
  const content: Record<string, unknown> = { id: request.externalId, project: expected.container.containerIdentity,
    ...planeCreateFields(expected), state: "external-status", updated_at: "2026-09-27T08:30:20.123456+08:00",
    url: "https://plane.example/items/item", labels: [{ color: "red" }] };
  return { expected, request, content };
}

describe("known Plane item observation", () => {
  it("preserves status, precise provider token and all JSON without sharing mutable provider data", () => {
    const { request, content } = fixture();
    const original = JSON.parse(JSON.stringify(content));

    const result = planeKnownItemObservation(content, request)!;
    (content.labels as { color: string }[])[0]!.color = "blue";

    expect(result).toEqual({ externalId: "stored-item", externalUrl: "https://plane.example/items/item",
      externalStatus: "external-status", concurrencyToken: "2026-09-27T08:30:20.123456+08:00", content: original });
  });

  it("preserves prototype-named JSON fields without prototype mutation", () => {
    const { request, content } = fixture();
    const value = JSON.parse(JSON.stringify(content).replace('"labels":', '"__proto__":{"safe":true},"labels":'));

    const result = planeKnownItemObservation(value, request)!;

    expect(Object.hasOwn(result.content, "__proto__")).toBe(true);
    expect(result.content.__proto__).toEqual({ safe: true });
    expect(({} as Record<string, unknown>).safe).toBeUndefined();
  });

  it.each(["changed", "", null, undefined])("captures changed/null/missing markers: %s", marker => {
    const { request, content } = fixture();
    if (marker === undefined) { delete content.external_id; delete content.external_source; }
    else { content.external_id = marker; content.external_source = marker; }

    const result = planeKnownItemObservation(content, request);

    expect(result!.content).toEqual(content);
  });

  it.each([
    ["id", "different"], ["project", "different"], ["id", null], ["project", null],
    ["name", null], ["name", 1], ["description_html", null], ["description_html", []],
    ["external_id", false], ["external_source", 1], ["state", {}], ["updated_at", null],
    ["updated_at", "2026-02-30T00:00:00Z"], ["updated_at", "2026-09-27T08:30:20+24:00"]
  ])("rejects invalid identity/managed observation %s: %j", (field, value) => {
    const { request, content } = fixture(); content[field as string] = value;
    expect(planeKnownItemObservation(content, request)).toBeNull();
  });

  it.each(["name", "description_html", "id", "project"])("rejects missing required %s", field => {
    const { request, content } = fixture(); delete content[field];
    expect(planeKnownItemObservation(content, request)).toBeNull();
  });

  it("accepts empty title and HTML while retaining absent optional observations as null", () => {
    const { request, content } = fixture(); content.name = ""; content.description_html = "";
    delete content.state; delete content.updated_at; delete content.url;
    expect(planeKnownItemObservation(content, request)).toEqual({ externalId: "stored-item", externalUrl: null,
      externalStatus: null, concurrencyToken: null, content });
  });

  it.each([undefined, NaN, Infinity, BigInt(1), new Date(), new Map(), () => 1, [1, , 2]])("rejects non-JSON unknown fields: %s", value => {
    const { request, content } = fixture(); content.unknown = value;
    expect(planeKnownItemObservation(content, request)).toBeNull();
  });

  it("rejects circular data and accessor properties without executing them", () => {
    const { request, content } = fixture(); content.circular = content;
    expect(planeKnownItemObservation(content, request)).toBeNull();
    delete content.circular;
    let reads = 0;
    Object.defineProperty(content, "name", { enumerable: true, get() { reads++; return "secret"; } });
    expect(planeKnownItemObservation(content, request)).toBeNull();
    expect(reads).toBe(0);
  });
});

describe("Plane managed content comparison", () => {
  it("uses escaped current revision HTML and original create marker while ignoring external-only changes", () => {
    const { expected, request, content } = fixture();
    content.state = "different"; content.labels = ["different"]; content.assignees = ["external-user"];
    const observed = planeKnownItemObservation(content, request)!;

    const result = planeManagedContent.compare({ expected, observed });

    expect(result).toEqual([]);
    expect(observed.content.description_html).toContain("&lt;script&gt; &amp; &#39;引號&#39;<br>下一行");
    expect(observed.content.external_id).toBe("original-create-key");
  });

  it("reports four fields in deterministic order and distinguishes missing from null", () => {
    const { expected, request, content } = fixture();
    content.name = ""; content.description_html = "changed"; delete content.external_source; content.external_id = null;
    const observed = planeKnownItemObservation(content, request)!;

    const result = planeManagedContent.compare({ expected, observed });
    observed.content.name = "mutated later";

    const fields = planeCreateFields(expected);
    expect(result).toEqual([
      { field: "name", expected: fields.name, observed: { present: true, value: "" } },
      { field: "description_html", expected: fields.description_html, observed: { present: true, value: "changed" } },
      { field: "external_source", expected: "ai-product-graph", observed: { present: false } },
      { field: "external_id", expected: "original-create-key", observed: { present: true, value: null } }
    ]);
  });

  it("compares exact HTML without silently normalizing provider whitespace", () => {
    const { expected, request, content } = fixture(); content.description_html += "\n";
    expect(planeManagedContent.compare({ expected, observed: planeKnownItemObservation(content, request)! }))
      .toEqual([{ field: "description_html", expected: planeCreateFields(expected).description_html,
        observed: { present: true, value: content.description_html } }]);
  });

  it("rejects invalid pinned payloads and malformed observations instead of manufacturing differences", () => {
    const { expected, request, content } = fixture(); const observed = planeKnownItemObservation(content, request)!;
    expect(() => planeManagedContent.compare({ expected: { ...expected, payloadHash: "wrong" }, observed })).toThrow();
    observed.content.external_id = {};
    expect(() => planeManagedContent.compare({ expected, observed })).toThrow("Invalid Plane content observation.");
  });

  it("rejects contradictory identity and status metadata", () => {
    const { expected, request, content } = fixture(); const observed = planeKnownItemObservation(content, request)!;
    for (const change of [{ externalId: "another" }, { externalStatus: "another" }, { concurrencyToken: null }, { externalUrl: null }]) {
      expect(() => planeManagedContent.compare({ expected, observed: { ...observed, ...change } })).toThrow();
    }
  });
});
