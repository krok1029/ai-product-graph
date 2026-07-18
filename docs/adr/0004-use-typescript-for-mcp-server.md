# ADR 0004：MCP Server 第一版使用 TypeScript

## Status

Accepted

## Context

AI Product Graph 的第一版會是一個本機 MCP server。它需要定義 MCP tools、resources、prompts、資料 schema、tool input / output validation，以及之後可能和 Web UI 共用 domain types。

候選技術主要是 TypeScript 和 Python。

## Options Considered

### TypeScript

優點：

- 適合定義 MCP tool schema 和 domain types。
- Node.js 生態適合開發 MCP server。
- 之後如果加入 Web UI，可以和前端共享 type definitions。
- 對 JSON、schema validation、package distribution 都很自然。

缺點：

- AI workflow、資料處理和 SQLite scripting 有時不如 Python 快。
- 需要處理 Node.js package、build、runtime 設定。

### Python

優點：

- AI workflow、prompt pipeline、資料處理和 SQLite 操作都很順。
- 適合快速實驗 LLM orchestration。

缺點：

- 如果之後加入 Web UI，前後端型別共享較弱。
- MCP tools 的 schema 和產品 domain types 可能比較容易分散。

## Decision

第一版 MCP server 使用 TypeScript。

Toolchain 優先試用 TypeScript 7 / `tsgo`。如果 dependency tooling、compiler API、MCP SDK、SQLite driver 或 test runner 相容性不足，保留 TypeScript 6 fallback。

## Rationale

- 這個產品的第一個核心是「穩定的 MCP tool surface」，TypeScript 對 schema 和 type contracts 較有優勢。
- 未來如果加入 Web UI，TypeScript 可以降低前後端模型不一致的成本。
- MCP server 需要被 agent 安全呼叫，明確的 input / output types 是核心品質要求。
- TypeScript 7 使用 Go-based native implementation，適合試用更快的 typechecking 和 language service；但第一版不能依賴尚未穩定的 API surface。

## Trade-offs

- 接下來若要做較重的 AI data processing，可能會比 Python 多一些實作成本。
- 若某些 AI workflow 很適合 Python，之後可以把它拆成獨立 worker 或 script，而不是改變 MCP server 主 runtime。
- 接受 TypeScript 7 / `tsgo` 可能遇到 toolchain 相容性問題，因此需要 TypeScript 6 fallback。

## Consequences

- 專案 scaffold 應以 Node.js + TypeScript 為主。
- MCP tool schemas、domain models、storage repository interfaces 應優先用 TypeScript types 定義。
- Python 可以保留給未來離線分析、migration 或實驗腳本，但不是 server runtime。
- `typecheck` 可優先嘗試 `tsgo`，但 build/test scripts 不應只依賴 TypeScript 7。
