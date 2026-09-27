import Database from "better-sqlite3";
import type { PlaneCreateRequest, PlaneItemObservation, PlaneProviderPort } from "../application/plane-provider-port.js";

// 獨立 SQLite 模擬 provider 的持久化邊界，避免本機 rollback 假裝撤銷外部成功。
export function durablePlaneProvider(path: string) {
  const database = new Database(path);
  database.exec(`CREATE TABLE IF NOT EXISTS provider_items (
    request_key TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, observation_json TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS provider_calls (operation TEXT NOT NULL, request_key TEXT NOT NULL);`);
  const port: PlaneProviderPort = {
    async create(request) {
      database.prepare("INSERT INTO provider_calls VALUES ('create', ?)").run(request.idempotencyKey);
      const existing = find(request);
      if (existing) return { status: "succeeded", item: existing };
      const observation: PlaneItemObservation = {
        externalId: `remote-${count() + 1}`, externalUrl: null,
        content: { ...request.payload.specification as Record<string, unknown>, labels: ["external-only"] },
        externalStatus: "backlog", concurrencyToken: "version-1"
      };
      database.prepare("INSERT INTO provider_items VALUES (?, ?, ?)")
        .run(request.idempotencyKey, request.payloadHash, JSON.stringify(observation));
      return { status: "succeeded", item: observation };
    },
    async reconcile(request) {
      database.prepare("INSERT INTO provider_calls VALUES ('reconcile', ?)").run(request.idempotencyKey);
      const observation = find(request);
      // 此 adapter 在 create 的首個 await 前即持久化，且 key 唯一，沒有晚到寫入。
      return observation ? { status: "found", item: observation }
        : { status: "definitely_absent", evidence: { guarantee: "synchronous-durable-keyed-create" } };
    }
  };
  function find(request: PlaneCreateRequest) {
    const row = database.prepare("SELECT payload_hash, observation_json FROM provider_items WHERE request_key = ?")
      .get(request.idempotencyKey) as { payload_hash: string; observation_json: string } | undefined;
    if (!row) return null;
    if (row.payload_hash !== request.payloadHash) throw new Error("Provider key payload mismatch");
    return JSON.parse(row.observation_json) as PlaneItemObservation;
  }
  function count() { return (database.prepare("SELECT count(*) AS count FROM provider_items").get() as { count: number }).count; }
  return { port, count, calls: () => database.prepare("SELECT operation FROM provider_calls ORDER BY rowid").all(),
    close: () => { database.close(); } };
}
