import { describe, expect, it } from "vitest";
import { hashJson, planeExportPayload } from "../../application/plane-export-payload.js";
import type { PlaneCreateRequest } from "../../application/plane-provider-port.js";
import { acceptanceFixture } from "../../test-support/result-acceptance-fixture.js";
import { planeCreateFields, planeItemObservation } from "./fields.js";

function requestFixture(): PlaneCreateRequest {
  const payload = {
    schema_version: 1, owner: { type: "ticket", id: "ticket-1" }, source_ticket_revision_id: "revision-1",
    specification: {
      title: "中文 <Ticket> & title", user_story: "使用者希望 <script>alert('x')</script>\n第二行 & \"引號\"",
      scope: ["登入 <form>\r\n保留換行"], acceptance_criteria: [{ id: "criterion-<1>", text: "看到成功 & 訊息" }],
      non_goals: ["不寫 assignees"], implementation_notes: ["注記 > 規格"]
    }
  };
  return {
    container: { id: "container-1", provider: "plane", workspaceIdentity: "workspace", containerIdentity: "project-1",
      displayName: null, createdAt: "2026-09-27T00:00:00.000Z", updatedAt: "2026-09-27T00:00:00.000Z" },
    payload, payloadHash: hashJson(payload), idempotencyKey: "plane-ticket-export:stable-key"
  };
}

function itemFixture() {
  return {
    id: "plane-item-1", project: "project-1", external_source: "ai-product-graph",
    external_id: "plane-ticket-export:stable-key", state: "state-1", updated_at: "2026-09-27T08:30:20.123456+08:00",
    url: "https://plane.example/work/item-1", name: "Provider title", labels: [{ id: "label-1", color: "red" }],
    assignees: ["user-1"], future: { nested: [false, null, 1.5, "中文"] }
  };
}

function modifiedRequest(change: (payload: Record<string, unknown>) => void): PlaneCreateRequest {
  const request = requestFixture();
  change(request.payload);
  request.payloadHash = hashJson(request.payload);
  return request;
}

describe("planeCreateFields", () => {
  const target = planeCreateFields;

  it("should format the actual approved Ticket payload with its generated stable criterion IDs", () => {
    const fixture = acceptanceFixture();
    try {
      const payload = planeExportPayload(fixture.revision);
      const request = { ...requestFixture(), payload, payloadHash: hashJson(payload) };

      const result = target(request);

      expect(result.name).toBe("Deliver feature");
      expect(result.description_html).toContain("As a user, I can verify delivery.");
      for (const criterion of fixture.revision.specification.acceptance_criteria) {
        expect(result.description_html).toContain(`<strong>${criterion.id}</strong>: ${criterion.text}`);
      }
      expect(result.description_html).not.toContain("Implementation notes");
    } finally {
      fixture.database.close();
    }
  });

  it("should project only four create fields and escape HTML while preserving stable criteria and line breaks", () => {
    const request = requestFixture();

    const result = target(request);

    expect(result).toEqual({
      name: "中文 <Ticket> & title", external_source: "ai-product-graph", external_id: "plane-ticket-export:stable-key",
      description_html: '<h2>User story</h2><p>使用者希望 &lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;<br>第二行 &amp; &quot;引號&quot;</p>\n' +
        '<h2>Scope</h2><ul><li>登入 &lt;form&gt;<br>保留換行</li></ul>\n' +
        '<h2>Acceptance criteria</h2><ul><li><strong>criterion-&lt;1&gt;</strong>: 看到成功 &amp; 訊息</li></ul>\n' +
        '<h2>Non-goals</h2><ul><li>不寫 assignees</li></ul>\n' +
        '<h2>Implementation notes</h2><ul><li>注記 &gt; 規格</li></ul>'
    });
  });

  it.each([undefined, []])("should omit optional notes section for %s", notes => {
    const request = modifiedRequest(payload => {
      const specification = payload.specification as Record<string, unknown>;
      if (notes === undefined) delete specification.implementation_notes;
      else specification.implementation_notes = notes;
      specification.scope = [];
      specification.non_goals = [];
    });

    const result = target(request);

    expect(result.description_html).not.toContain("Implementation notes");
    expect(result.description_html).toContain("<h2>Scope</h2><ul></ul>");
    expect(result.description_html).toContain("<h2>Non-goals</h2><ul></ul>");
  });

  it("should not copy unmanaged fields from an otherwise valid pinned payload", () => {
    const request = modifiedRequest(payload => Object.assign(payload.specification as object,
      { labels: ["mine"], assignees: ["user"], comments: "comment", priority: "urgent", state: "done", url: "https://example.com" }));

    const result = target(request);

    expect(Object.keys(result).sort()).toEqual(["description_html", "external_id", "external_source", "name"]);
    expect(result.description_html).not.toContain("urgent");
  });

  it.each([
    ["version", (payload: Record<string, unknown>) => { payload.schema_version = 2; }],
    ["owner type", (payload: Record<string, unknown>) => { payload.owner = { type: "target", id: "id" }; }],
    ["owner id", (payload: Record<string, unknown>) => { payload.owner = { type: "ticket", id: " " }; }],
    ["revision", (payload: Record<string, unknown>) => { payload.source_ticket_revision_id = ""; }],
    ["specification", (payload: Record<string, unknown>) => { delete payload.specification; }]
  ] as const)("should reject invalid %s even with a matching hash", (_name, change) => {
    const request = modifiedRequest(change);

    expect(() => target(request)).toThrow("Invalid pinned Plane create payload.");
  });

  it.each([
    ["title", " "], ["user_story", null], ["scope", "scope"], ["scope", [1]], ["non_goals", null],
    ["acceptance_criteria", []], ["acceptance_criteria", ["text"]],
    ["acceptance_criteria", [{ id: "a", text: "a" }, { id: "a", text: "b" }]],
    ["acceptance_criteria", [{ id: "a", text: "" }]], ["implementation_notes", "note"]
  ])("should reject malformed specification %s: %j", (key, value) => {
    const request = modifiedRequest(payload => { (payload.specification as Record<string, unknown>)[key as string] = value; });

    expect(() => target(request)).toThrow("Invalid pinned Plane create payload.");
  });

  it("should reject payload changed after hashing", () => {
    const request = requestFixture();
    (request.payload.specification as Record<string, unknown>).title = "Changed after approval";

    expect(() => target(request)).toThrow("Invalid pinned Plane create request.");
  });

  it("should reject a blank stable marker", () => {
    const request = { ...requestFixture(), idempotencyKey: " " };

    expect(() => target(request)).toThrow("Invalid pinned Plane create request.");
  });
});

describe("planeItemObservation", () => {
  const target = planeItemObservation;

  it("should keep all provider JSON and genuine status/token without sharing mutable objects", () => {
    const request = requestFixture();
    const item = itemFixture();

    const result = target(item, request);
    item.labels[0]!.color = "blue";

    expect(result).toEqual({ externalId: "plane-item-1", externalUrl: "https://plane.example/work/item-1",
      externalStatus: "state-1", concurrencyToken: "2026-09-27T08:30:20.123456+08:00", content: itemFixture() });
  });

  it("should retain unknown prototype-named fields as data", () => {
    const item = JSON.parse(JSON.stringify(itemFixture()).replace('"future":', '"__proto__":{"polluted":true},"future":')) as unknown;

    const result = target(item, requestFixture());

    expect(Object.hasOwn(result!.content, "__proto__")).toBe(true);
    expect(result!.content.__proto__).toEqual({ polluted: true });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each([undefined, null])("should preserve missing/null state and absent timestamp/url as null", state => {
    const item: Record<string, unknown> = itemFixture();
    delete item.updated_at;
    delete item.url;
    if (state === undefined) delete item.state;
    else item.state = state;

    const result = target(item, requestFixture());

    expect(result).toEqual({ externalId: "plane-item-1", externalUrl: null, externalStatus: null,
      concurrencyToken: null, content: item });
  });

  it.each([
    ["id", " "], ["id", 1], ["project", "other-project"], ["external_source", "another-app"],
    ["external_id", "another-intent"], ["state", { id: "state" }], ["updated_at", null], ["updated_at", ""],
    ["updated_at", "not-a-date"], ["updated_at", "2026-09-27"], ["updated_at", "2026-02-30T00:00:00Z"]
  ])("should reject unverified identity or malformed %s: %j", (key, value) => {
    const item = { ...itemFixture(), [key as string]: value };

    expect(target(item, requestFixture())).toBeNull();
  });

  it.each(["javascript:alert(1)", "/relative", "https:plane.example/item", "https://plane.example/line\nbreak", "https://user:secret@example.com/item", " https://plane.example/item ", 123])(
    "should not promote untrusted URL %s to external URL", url => {
      const item = { ...itemFixture(), url };

      const result = target(item, requestFixture());

      expect(result!.externalUrl).toBeNull();
      expect(result!.content.url).toEqual(url);
    });

  it.each([undefined, NaN, Infinity, BigInt(1), () => 1, new Date(), new Map(), Symbol("x"), [1, , 2]])(
    "should reject non-JSON nested data %s", value => {
      const item = { ...itemFixture(), unknown: value };

      expect(target(item, requestFixture())).toBeNull();
    });

  it("should reject circular input without throwing", () => {
    const item: Record<string, unknown> = itemFixture();
    item.circular = item;

    expect(target(item, requestFixture())).toBeNull();
  });

  it("should reject accessors without evaluating provider code", () => {
    let reads = 0;
    const item = Object.defineProperty(itemFixture(), "unknown", { enumerable: true, get() { reads += 1; return "secret"; } });

    const result = target(item, requestFixture());

    expect(result).toBeNull();
    expect(reads).toBe(0);
  });

  it("should reject invalid pinned request for an otherwise matching item", () => {
    const request = requestFixture();
    request.payloadHash = "not-the-hash";

    expect(target(itemFixture(), request)).toBeNull();
  });
});
