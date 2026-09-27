import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { PlaneReadRequest } from "../../application/plane-observation-ports.js";
import { PlaneHttpProvider } from "./http-provider.js";

const secret = "test-observation-key";
function request(): PlaneReadRequest {
  return { container: { id: "container", provider: "plane", workspaceIdentity: "workspace", containerIdentity: "project",
    displayName: null, createdAt: "2026-09-27T00:00:00Z", updatedAt: "2026-09-27T00:00:00Z" }, externalId: "external" };
}
function item(req = request()) {
  return { id: req.externalId, project: req.container.containerIdentity, name: "Title", description_html: "<p>Content</p>",
    external_source: "changed-app", external_id: null, state: "opaque-state", updated_at: "2026-09-27T00:00:00.123456Z" };
}
function provider(fetch: typeof globalThis.fetch, extra = {}) {
  return new PlaneHttpProvider({ baseUrl: "https://plane.example", apiKey: secret, fetch, ...extra });
}
async function loopback(handler: (req: IncomingMessage, res: ServerResponse) => void, run: (baseUrl: string) => Promise<void>) {
  const server = createServer(handler); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing loopback port");
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

describe("Plane known-item HTTP observation", () => {
  it("performs one explicit GET with encoded identities, authentication and no marker filters or body", async () => {
    const req = request(); req.container.workspaceIdentity = "space/中文"; req.container.containerIdentity = "project?one";
    req.externalId = "item/#?中文";
    const calls: { method?: string; url?: string; key?: string | string[]; body: string }[] = [];
    await loopback((incoming, outgoing) => {
      let body = ""; incoming.on("data", chunk => { body += String(chunk); });
      incoming.on("end", () => {
        calls.push({ method: incoming.method, url: incoming.url, key: incoming.headers["x-api-key"], body });
        outgoing.writeHead(200, { "Content-Type": "application/json" }); outgoing.end(JSON.stringify(item(req)));
      });
    }, async baseUrl => {
      const adapter = new PlaneHttpProvider({ baseUrl, apiKey: secret });
      expect(calls).toEqual([]);
      expect(await adapter.readKnownItem(req)).toMatchObject({ status: "observed", item: { externalId: req.externalId,
        content: { external_source: "changed-app", external_id: null }, concurrencyToken: "2026-09-27T00:00:00.123456Z" } });
    });
    expect(calls).toEqual([{ method: "GET", url: "/api/v1/workspaces/space%2F%E4%B8%AD%E6%96%87/projects/project%3Fone/work-items/item%2F%23%3F%E4%B8%AD%E6%96%87/", key: secret, body: "" }]);
  });

  it.each(["", " ", ".", ".."]) ("rejects invalid identity segment %s without network", async value => {
    const fetch = vi.fn();
    for (const field of ["externalId", "workspaceIdentity", "containerIdentity"]) {
      const req = request();
      if (field === "externalId") req.externalId = value;
      else req.container[field as "workspaceIdentity" | "containerIdentity"] = value;
      expect(await provider(fetch).readKnownItem(req)).toEqual({ status: "unknown", error: { code: "INVALID_PLANE_REQUEST" } });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([404, 401, 429, 500, 302])("keeps rejected HTTP %s unknown without retries or sensitive body", async status => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(secret, { status }));
    expect(await provider(fetch).readKnownItem(request())).toEqual({ status: "unknown", error: { code: "PLANE_HTTP_REJECTED", http_status: status } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: "GET", redirect: "error" });
  });

  it.each([null, [], {}, { ...item(), id: "another" }, { ...item(), project: "another" },
    { ...item(), description_html: null }, { results: [item()] }])("rejects malformed/incomplete or wrong identity response %j", async value => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(value)));
    expect(await provider(fetch).readKnownItem(request())).toEqual({ status: "unknown", error: { code: "INVALID_PLANE_RESPONSE" } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("redacts exceptions, malformed JSON and rejected bodies", async () => {
    const throwing = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error(secret));
    expect(await provider(throwing).readKnownItem(request())).toEqual({ status: "unknown", error: { code: "PLANE_TRANSPORT_ERROR" } });
    const malformed = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(`{"secret":"${secret}"`));
    expect(await provider(malformed).readKnownItem(request())).toEqual({ status: "unknown", error: { code: "INVALID_PLANE_RESPONSE" } });
  });

  it.each([{}, { "content-length": "9999" }])("bounds bytes with and without length header %j", async headers => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("一".repeat(50), { headers }));
    expect(await provider(fetch, { maxResponseBytes: 100 }).readKnownItem(request()))
      .toEqual({ status: "unknown", error: { code: "PLANE_RESPONSE_TOO_LARGE" } });
  });

  it("enforces timeout and abort even when injected fetch ignores the signal", async () => {
    let signal: AbortSignal | null | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_url, init) => {
      signal = init?.signal; return new Promise<Response>(() => {});
    });
    expect(await provider(fetch, { timeoutMs: 30 }).readKnownItem(request())).toEqual({ status: "unknown", error: { code: "PLANE_TIMEOUT" } });
    expect(signal?.aborted).toBe(true); expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("aborts actual partial HTTP body at the fixed deadline", async () => {
    let markClosed!: () => void; const closed = new Promise<void>(resolve => { markClosed = resolve; });
    await loopback((_incoming, outgoing) => {
      outgoing.on("close", markClosed); outgoing.writeHead(200, { "Content-Type": "application/json" }); outgoing.write('{"partial":');
    }, async baseUrl => {
      expect(await new PlaneHttpProvider({ baseUrl, apiKey: secret, timeoutMs: 50 }).readKnownItem(request()))
        .toEqual({ status: "unknown", error: { code: "PLANE_TIMEOUT" } });
      await closed;
    });
  });

  it("refuses actual redirects before the target can receive credentials", async () => {
    let leaked = false;
    await loopback((_incoming, outgoing) => { leaked = true; outgoing.end(JSON.stringify(item())); }, async target => {
      await loopback((_incoming, outgoing) => { outgoing.writeHead(307, { Location: target }); outgoing.end(); }, async baseUrl => {
        expect(await new PlaneHttpProvider({ baseUrl, apiKey: secret }).readKnownItem(request()))
          .toEqual({ status: "unknown", error: { code: "PLANE_TRANSPORT_ERROR" } });
      });
    });
    expect(leaked).toBe(false);
  });
});
