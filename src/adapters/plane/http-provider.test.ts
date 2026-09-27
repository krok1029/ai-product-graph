import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { hashJson } from "../../application/plane-export-payload.js";
import type { PlaneCreateRequest } from "../../application/plane-provider-port.js";
import { PlaneHttpProvider } from "./http-provider.js";

const secret = "test-credential-not-for-output";
function request(): PlaneCreateRequest {
  const payload = { schema_version: 1, owner: { type: "ticket", id: "ticket" },
    source_ticket_revision_id: "revision", specification: { title: "功能 <title>", user_story: "使用者故事",
      scope: ["工作範圍"], acceptance_criteria: [{ id: "AC-1", text: "驗證" }], non_goals: [] } };
  return { container: { id: "container", provider: "plane", workspaceIdentity: "workspace", containerIdentity: "project",
    displayName: null, createdAt: "2026-09-27T00:00:00Z", updatedAt: "2026-09-27T00:00:00Z" },
    idempotencyKey: "plane-ticket-export:stable&key", payload, payloadHash: hashJson(payload) };
}
function item(req = request()) {
  return { id: "external", project: req.container.containerIdentity, external_source: "ai-product-graph",
    external_id: req.idempotencyKey, name: "功能 <title>", state: "state-id", updated_at: "2026-09-27T00:00:00Z", labels: ["external-only"] };
}
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }); }
function provider(fetch: typeof globalThis.fetch, extra = {}) {
  return new PlaneHttpProvider({ baseUrl: "https://plane.example", apiKey: secret, fetch, ...extra });
}
async function loopback(handler: (req: IncomingMessage, res: ServerResponse) => void, run: (baseUrl: string) => Promise<void>) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing loopback port");
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

describe("Plane HTTP provider", () => {
  it("sends only managed fields with encoded scope and markers over actual HTTP", async () => {
    const req = request();
    req.container.workspaceIdentity = "space/中文";
    req.container.containerIdentity = "project?one";
    const calls: { method: string | undefined; url: string | undefined; key: string | string[] | undefined; body: string }[] = [];
    await loopback((incoming, outgoing) => {
      let body = "";
      incoming.on("data", chunk => { body += String(chunk); });
      incoming.on("end", () => {
        calls.push({ method: incoming.method, url: incoming.url, key: incoming.headers["x-api-key"], body });
        outgoing.writeHead(incoming.method === "POST" ? 201 : 200, { "Content-Type": "application/json" });
        outgoing.end(JSON.stringify(item(req)));
      });
    }, async baseUrl => {
      const adapter = new PlaneHttpProvider({ baseUrl, apiKey: secret });
      expect(await adapter.create(req)).toMatchObject({ status: "succeeded", item: { externalId: "external", content: { labels: ["external-only"] } } });
      expect(await adapter.reconcile(req)).toMatchObject({ status: "found" });
    });
    const post = calls[0]!;
    expect(post.method).toBe("POST");
    expect(post.url).toBe("/api/v1/workspaces/space%2F%E4%B8%AD%E6%96%87/projects/project%3Fone/work-items/");
    expect(post.key).toBe(secret);
    expect(Object.keys(JSON.parse(post.body)).sort()).toEqual(["description_html", "external_id", "external_source", "name"]);
    expect(JSON.parse(post.body)).toMatchObject({ external_id: req.idempotencyKey, external_source: "ai-product-graph" });
    const query = new URL(calls[1]!.url!, "https://plane.example").searchParams;
    expect(query.get("external_id")).toBe(req.idempotencyKey);
    expect(query.get("external_source")).toBe("ai-product-graph");
  });

  it.each(["http://plane.example", "https://user:pass@plane.example", "https://plane.example/path", "https://plane.example/a/..", "https://plane.example?", "https://plane.example#", "file:///tmp/plane",
    "https://plane.example\\path", "https://plane.example\\", "https://plane.example/\t",
    "https://plane.example\n", "https://plane.example\r", "https://plane.example\0",
    "https://plane.example\x7f", " https://plane.example", "https://plane.example "])("rejects unsafe origin %s", baseUrl => {
    expect(() => new PlaneHttpProvider({ baseUrl, apiKey: secret })).toThrow("INVALID_PLANE_CONFIG");
  });
  it.each(["", " ", "key\r\nHeader: injected", "key\0", "中文"])("rejects invalid credentials", apiKey => {
    expect(() => new PlaneHttpProvider({ baseUrl: "https://plane.example", apiKey })).toThrow("INVALID_PLANE_CONFIG");
  });
  it.each([0, -1, NaN, Infinity, 0.5, 2 ** 32])("rejects invalid resource limit %s", value => {
    for (const key of ["timeoutMs", "maxPages", "maxResponseBytes"]) {
      expect(() => provider(vi.fn(), { [key]: value })).toThrow("INVALID_PLANE_CONFIG");
    }
  });
  it("rejects invalid scope and payload before any HTTP invocation", async () => {
    const fetch = vi.fn();
    for (const value of ["", " ", ".", ".."]) {
      const req = request(); req.container.workspaceIdentity = value;
      expect(await provider(fetch).create(req)).toMatchObject({ status: "failed", error: { code: "INVALID_PLANE_REQUEST" } });
      expect(await provider(fetch).reconcile(req)).toMatchObject({ status: "unknown" });
    }
    const req = request(); req.payloadHash = "invalid";
    expect(await provider(fetch).create(req)).toMatchObject({ status: "failed" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads every page on the same endpoint, deduplicating identical observations", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({ results: [item()], next_cursor: "https://evil.example/?key=oops", next_page_results: true }))
      .mockResolvedValueOnce(response({ results: [item()], next_cursor: null, next_page_results: false }));
    expect(await provider(fetch).reconcile(request())).toMatchObject({ status: "found" });
    expect(fetch).toHaveBeenCalledTimes(2);
    const url = new URL(String(fetch.mock.calls[1]![0]));
    expect(url.origin).toBe("https://plane.example");
    expect(url.pathname).toBe("/api/v1/workspaces/workspace/projects/project/work-items/");
    expect(url.searchParams.get("cursor")).toBe("https://evil.example/?key=oops");
    expect(fetch.mock.calls[1]![1]).toMatchObject({ redirect: "error" });
  });
  it.each([
    { results: [], next_page_results: false },
    { results: [item()] },
    { results: "invalid", next_page_results: false },
    { results: [{ ...item(), project: "other" }], next_page_results: false },
    { results: [{ ...item(), external_id: "other" }], next_page_results: false },
    { results: [item(), { ...item(), id: "another" }], next_page_results: false },
    { results: [item(), { ...item(), name: "conflicting" }], next_page_results: false },
    { results: [item()], next_page_results: true, next_cursor: "" },
    null, [], "invalid"
  ])("keeps incomplete, empty, conflicting or wrong-scope reconciliation unknown", async value => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(value));
    expect(await provider(fetch).reconcile(request())).toMatchObject({ status: "unknown" });
  });
  it("rejects a later conflicting page instead of accepting the first match", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({ results: [item()], next_page_results: true, next_cursor: "next" }))
      .mockResolvedValueOnce(response({ results: [{ ...item(), state: "changed" }], next_page_results: false }));
    expect(await provider(fetch).reconcile(request())).toMatchObject({ status: "unknown", error: { code: "AMBIGUOUS_PLANE_RESPONSE" } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("detects cursor loops and exhausted page budgets", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => response({ results: [], next_page_results: true, next_cursor: "same" }));
    expect(await provider(fetch).reconcile(request())).toMatchObject({ status: "unknown", error: { code: "INVALID_PLANE_CURSOR" } });
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockClear();
    expect(await provider(fetch, { maxPages: 1 }).reconcile(request())).toMatchObject({ status: "unknown", error: { code: "PLANE_PAGE_LIMIT" } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([401, 404, 409, 429, 500, 302])("sanitizes status %s without retrying POST", async status => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => response({ secret, message: "sensitive response" }, status));
    expect(await provider(fetch).create(request())).toEqual({ status: "failed", error: { code: "PLANE_HTTP_REJECTED", http_status: status } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await provider(fetch).reconcile(request())).toEqual({ status: "unknown", error: { code: "PLANE_HTTP_REJECTED", http_status: status } });
  });
  it("redacts thrown exceptions and malformed success bodies", async () => {
    const throwing = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error(secret));
    expect(await provider(throwing).create(request())).toEqual({ status: "unknown", error: { code: "PLANE_TRANSPORT_ERROR" } });
    for (const body of [secret, JSON.stringify({ key: secret })]) {
      const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response(body));
      const result = await provider(fetch).create(request());
      expect(result).toEqual({ status: "unknown", error: { code: "INVALID_PLANE_RESPONSE" } });
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  });
  it("bounds response bytes both with and without content-length and across pages", async () => {
    for (const headers of [{}, { "content-length": "9999" }]) {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("一".repeat(50), { headers }));
      expect(await provider(fetch, { maxResponseBytes: 100 }).create(request())).toMatchObject({ error: { code: "PLANE_RESPONSE_TOO_LARGE" } });
    }
    const page = { results: [item()], next_page_results: true, next_cursor: "next" };
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => response(page));
    expect(await provider(fetch, { maxResponseBytes: Buffer.byteLength(JSON.stringify(page)) + 10 }).reconcile(request())).toMatchObject({ error: { code: "PLANE_RESPONSE_TOO_LARGE" } });
  });

  it("aborts actual HTTP body reads at the method deadline", async () => {
    let markClosed!: () => void;
    const closed = new Promise<void>(resolve => { markClosed = resolve; });
    await loopback((_incoming, outgoing) => {
      outgoing.on("close", markClosed);
      outgoing.writeHead(200, { "Content-Type": "application/json" });
      outgoing.write('{"partial":');
    }, async baseUrl => {
      const adapter = new PlaneHttpProvider({ baseUrl, apiKey: secret, timeoutMs: 50 });
      expect(await adapter.create(request())).toEqual({ status: "unknown", error: { code: "PLANE_TIMEOUT" } });
      await closed;
    });
  });
  it("shares one deadline across all pages, even when injected fetch ignores abort", async () => {
    let signal: AbortSignal | null | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_url, options) => {
      signal = options?.signal;
      if (fetch.mock.calls.length === 1) return response({ results: [item()], next_page_results: true, next_cursor: "next" });
      return new Promise<Response>(() => {});
    });
    expect(await provider(fetch, { timeoutMs: 30 }).reconcile(request())).toEqual({ status: "unknown", error: { code: "PLANE_TIMEOUT" } });
    expect(signal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not reset the deadline after an earlier page consumes time", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
        if (fetch.mock.calls.length > 1) return new Promise<Response>(() => {});
        await new Promise(resolve => setTimeout(resolve, 40));
        return response({ results: [item()], next_page_results: true, next_cursor: "next" });
      });
      let outcome: unknown;
      const work = provider(fetch, { timeoutMs: 60 }).reconcile(request()).then(value => { outcome = value; });
      await vi.advanceTimersByTimeAsync(40);
      expect(fetch).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(20);
      expect(outcome).toEqual({ status: "unknown", error: { code: "PLANE_TIMEOUT" } });
      await work;
    } finally { vi.useRealTimers(); }
  });
  it("refuses actual redirects without sending credentials to the target", async () => {
    let leaked = false;
    await loopback((_incoming, outgoing) => { leaked = true; outgoing.end(JSON.stringify(item())); }, async target => {
      await loopback((_incoming, outgoing) => { outgoing.writeHead(307, { Location: target }); outgoing.end(); }, async baseUrl => {
        expect(await new PlaneHttpProvider({ baseUrl, apiKey: secret }).create(request())).toMatchObject({ status: "unknown" });
      });
    });
    expect(leaked).toBe(false);
  });
});
