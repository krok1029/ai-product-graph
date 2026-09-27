# Explicit Plane HTTP first-export adapter

`PlaneHttpProvider` implements the existing `PlaneProviderPort` and separate `PlaneObservationProviderPort`. Construction requires an explicit origin and API key. It performs no requests until `create`, `reconcile`, or `readKnownItem` is called, and it does not start a worker or change stdio behavior. Credentials exist only in the adapter configuration and the outgoing `X-API-Key` header; application records receive fixed error codes and HTTP status numbers, never exception text or rejected response bodies.

```ts
const provider = new PlaneHttpProvider({
  baseUrl: "https://plane.example",
  apiKey,
  timeoutMs: 15_000,
  maxPages: 20,
  maxResponseBytes: 1_048_576
});
```

HTTPS is required except for loopback HTTP (`localhost`, `127.0.0.1`, `[::1]`). The origin cannot contain credentials, a base path, query, or fragment. Workspace and project identities are encoded as separate path segments; empty and dot segments are rejected. Positive integer limits bound the entire method, including response bodies and every reconciliation page. The default byte budget is shared across all pages. The timeout aborts the request and stream reads. An injected `fetch` supports isolated testing; it must obey normal fetch semantics.

Create sends one POST to `/api/v1/workspaces/{workspace}/projects/{project}/work-items/`. The pure field adapter supplies exactly `name`, `description_html`, `external_source`, and `external_id`, based on the pinned payload. It never sends assignees, labels, comments, state, or priority. A valid 2xx observation succeeds; rejected statuses produce a sanitized failed outcome. Transport errors, timeouts, excessive responses, and malformed success observations remain unknown. No POST is automatically retried, and redirects are prohibited for all methods.

Reconciliation sends GET to the same endpoint with both exact external marker filters. It accepts a single work item object or a paginated `{results, next_cursor, next_page_results}` envelope. Every item must match the expected project and markers. It follows cursors only as encoded query values on the configured origin and endpoint, never as server-supplied URLs. Identical repeated observations may be deduplicated; conflicting representations of one identity, multiple identities, malformed pages, repeated cursors, incomplete traversal, or exhausted budgets remain unknown.

Only one consistent observed identity after a complete traversal yields `found`. Empty responses and 404 responses remain unknown. This adapter **never returns `definitely_absent`**, because absence on a read cannot prove that an earlier create will not commit later. The existing durable claim logic therefore keeps an uncertain create in reconciliation mode; repeated empty reads cannot trigger a second POST. A rejected first attempt also remains conservatively fenced by the claim layer. Recovery that cannot find the item needs a future explicit resolution workflow; this adapter does not silently clear uncertainty.

The official [create contract](https://developers.plane.so/api-reference/issue/add-issue) documents the endpoint, managed field names, markers, and `X-API-Key` authentication. The [list contract](https://developers.plane.so/api-reference/issue/list-issues) documents marker filtering and cursor pagination. The [pinned official implementation](https://github.com/makeplane/plane/blob/5f7d92784c403f76284f0f16718f320221dc7fec/apps/api/plane/api/views/issue.py) returns a single object for both marker filters and permits read-replica use. Its create conflict check does not establish an atomic exactly-once guarantee. Supporting both response shapes and preserving uncertainty reflects those limits.

Tests use loopback HTTP servers and injected responses, with no live Plane request or credential discovery. They cover actual URL/header/body contracts, scope checks, both response shapes, ambiguity, cursor and resource limits, body-stream abortion, no POST retry, sanitized errors, and redirect credential isolation. PATCH, status sync, polling, scheduling, and production credential setup remain outside this adapter.

## Explicit known-item read

`readKnownItem({container, externalId})` sends exactly one GET to `/api/v1/workspaces/{workspace}/projects/{project}/work-items/{externalId}/`. All three identities are encoded as individual path segments; invalid/empty/dot identities produce `INVALID_PLANE_REQUEST` before any network request. It sends no marker filters, optional expansions, request body, POST or PATCH, and performs no automatic retry. The constructor remains network-free.

A validated known identity yields `{status:"observed", item}`. Unlike create reconciliation, changed/null/missing markers are retained so the managed-content comparator can report them. Wrong item/project, missing title/HTML, malformed JSON or invalid managed-field types yield `INVALID_PLANE_RESPONSE`. Rejected HTTP statuses, including 404, yield unknown `PLANE_HTTP_REJECTED` with the status number; they do not prove deletion or absence. Exceptions expose only `PLANE_TRANSPORT_ERROR`. Timeout and response byte limits reuse the existing bounded invocation, with `PLANE_TIMEOUT` and `PLANE_RESPONSE_TOO_LARGE` outcomes. Rejected bodies, exception messages, URLs and credentials never enter errors.

The [official known-item GET contract](https://developers.plane.so/api-reference/issue/get-issue-detail) specifies this addressed endpoint and `X-API-Key` authentication. Full scope and content validation remains required even when a documentation example omits project or HTML fields. Real-loopback and injected-response tests cover the read contract without live Plane access.

The application owns persistence and commit-time revision selection. Reading does not create a Sync Intent/Attempt, advance an outbound success baseline, or resolve earlier Content Drift. The adapter provides no status classification, polling, conditional write or drift import behavior.
