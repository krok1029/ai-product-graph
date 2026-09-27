// 整次 provider invocation 共用期限與讀取額度，包含所有 reconciliation pages。
export class PlaneHttpError extends Error {
  constructor(readonly code: string) { super(code); }
}

export type PlaneHttpConfig = {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  maxPages?: number;
  maxResponseBytes?: number;
  fetch?: typeof globalThis.fetch;
};

export function planeHttpConfig(config: PlaneHttpConfig) {
  const invalid = () => { throw new PlaneHttpError("INVALID_PLANE_CONFIG"); };
  let base: URL;
  try { base = new URL(config.baseUrl); } catch { return invalid(); }
  if (!/^https?:\/\/[^/?#]+\/?$/.test(config.baseUrl) || /[\s\\\x00-\x1f\x7f]/u.test(config.baseUrl) ||
      base.pathname !== "/" || base.search || base.hash || base.username || base.password ||
      (base.protocol !== "https:" && !(base.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)))) invalid();
  if (typeof config.apiKey !== "string" || !config.apiKey.trim() || /[\x00-\x1f\x7f-\uffff]/.test(config.apiKey)) invalid();
  const positive = (value: number | undefined, fallback: number) => {
    const result = value ?? fallback;
    if (!Number.isSafeInteger(result) || result <= 0 || result > 2_147_483_647) invalid();
    return result;
  };
  return {
    origin: base.origin, apiKey: config.apiKey,
    timeoutMs: positive(config.timeoutMs, 15_000),
    maxPages: positive(config.maxPages, 20),
    maxResponseBytes: positive(config.maxResponseBytes, 1_048_576),
    fetch: config.fetch ?? globalThis.fetch
  };
}

export type ValidatedPlaneHttpConfig = ReturnType<typeof planeHttpConfig>;

export class PlaneHttpInvocation {
  private readonly controller = new AbortController();
  private readonly deadline: Promise<never>;
  private readonly timer: ReturnType<typeof setTimeout>;
  private remainingBytes: number;

  constructor(private readonly config: ValidatedPlaneHttpConfig) {
    this.remainingBytes = config.maxResponseBytes;
    let timer!: ReturnType<typeof setTimeout>;
    this.deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new PlaneHttpError("PLANE_TIMEOUT"));
        this.controller.abort();
      }, config.timeoutMs);
    });
    this.timer = timer;
  }

  async request(url: URL, body?: unknown): Promise<Response> {
    return this.bounded(this.config.fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: { "X-API-Key": this.config.apiKey, "Accept": "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error", signal: this.controller.signal
    }));
  }

  async json(response: Response): Promise<unknown> {
    const length = response.headers.get("content-length");
    if (length !== null && Number(length) > this.remainingBytes) throw new PlaneHttpError("PLANE_RESPONSE_TOO_LARGE");
    if (!response.body) throw new PlaneHttpError("INVALID_PLANE_RESPONSE");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await this.bounded(reader.read());
        if (part.done) break;
        size += part.value.byteLength;
        this.remainingBytes -= part.value.byteLength;
        if (this.remainingBytes < 0) throw new PlaneHttpError("PLANE_RESPONSE_TOO_LARGE");
        chunks.push(part.value);
      }
    } finally {
      // 不等待不可信 stream 的取消完成；總期限不可被 cleanup 延長。
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new PlaneHttpError("INVALID_PLANE_RESPONSE"); }
  }

  close(): void { clearTimeout(this.timer); this.controller.abort(); }

  private async bounded<T>(work: Promise<T>): Promise<T> {
    try { return await Promise.race([work, this.deadline]); }
    catch (error) {
      if (error instanceof PlaneHttpError) throw error;
      throw new PlaneHttpError("PLANE_TRANSPORT_ERROR");
    }
  }
}
