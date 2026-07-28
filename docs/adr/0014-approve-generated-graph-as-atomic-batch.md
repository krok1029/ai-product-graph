# ADR 0014：AI 產生的 Graph 以 Batch 原子核准

## Status

Accepted

## Context

ADR 0007 規定 AI 生成的 graph proposed changes 必須 draft first，但尚未定義它們的審查與核准邊界。

一次 graph extraction 會同時產生互相關聯的 nodes 與 edges。如果 Product Brief 核准時自動核准萃取結果，AI 的遺漏或誤解會直接進入 canonical graph。如果逐一核准 node 或 edge，使用者可能留下缺少端點、關係不完整或只核准一半的 graph。

## Options Considered

### A：Product Brief 核准時自動核准 Graph

優點：

- 流程步驟最少。
- Graph 可以立即供後續 ticket generation 使用。

缺點：

- AI 萃取錯誤會直接進入 canonical graph。
- 使用者沒有獨立檢查 graph interpretation 的機會。

### B：逐一核准 Node 與 Edge

優點：

- 使用者可精細控制每個 graph entity。
- 可只保留部分 AI 建議。

缺點：

- 審查操作繁瑣。
- 容易產生缺少端點或只核准部分關係的不一致狀態。
- 難以判定一次萃取結果是否已完整處理。

### C：以 Graph Draft Batch 整批核准

優點：

- 保留獨立的人類審查關卡。
- Nodes 與 edges 能以一致集合進入 canonical graph。
- 可明確追溯至來源 Product Brief 版本與同一次萃取。

缺點：

- 使用者必須在核准前修正或重新產生不接受的內容。
- 核准流程需要 transaction 與 batch lifecycle。

## Decision

採用選項 C：同一次 AI graph extraction 產生的 proposed node／edge changes 構成一個 Graph Draft Batch，並綁定單一 approved Product Brief 版本。Review Status 屬於 batch；batch 內的 proposed items 不具有各自的 Review Status，也還不是 canonical GraphNodes 或 GraphEdges。

核准 Product Brief 不會自動核准 Graph Draft Batch。使用者必須獨立審查 batch，並以單一明確動作整批核准。Batch 核准必須是原子操作：所有 changes 一起套用到 canonical graph；只要任何一項驗證或寫入失敗，就全部維持原狀。套用後的 canonical GraphNodes 與 GraphEdges 只具有 Lifecycle Status。

若新版 Product Brief Version 與現有 graph 比較後不需要任何 node 或 edge 變更，Graph Draft Batch 可以是 no-op reconciliation：`changes` 為空，但必須保存 `reconciliation_summary` 並由使用者明確核准。No-op batch 核准後不修改 canonical graph entities。

新版 Product Brief 核准後，Project 的 Product Intent Reconciliation 為 `pending`。只有來源為目前 approved Product Brief Version 的 Graph Draft Batch 成功核准，才可在同一 transaction 將 reconciliation 更新為 `current`。Pending 期間不得執行 implementation handoff 或 Result Acceptance。

Batch 內的內容可以在核准前修正或重新產生，但不能逐一核准部分 nodes 或 edges。

## Rationale

- Graph extraction 是對 Product Brief 的 AI 詮釋，仍需要獨立的人類審查。
- Nodes 與 edges 具有結構依賴，不適合以彼此無關的項目核准。
- Batch 邊界能同時提供一致性與來源追溯。

## Trade-offs

- 接受 graph workflow 多一個獨立 review / approve step。
- 接受使用者不能直接部分核准 batch。
- 接受資料模型與 tools 需要支援 batch 狀態及原子寫入。

## Consequences

- 每個 Graph Draft Batch 必須具有穩定識別，並記錄來源 Product Brief 版本。
- No-op reconciliation batch 必須保存 reconciliation summary，且仍須經 batch approval。
- Batch approval 必須確認來源仍是目前 approved Product Brief Version，並原子更新 Product Intent Reconciliation pointers。
- Batch 核准前必須驗證 node 端點、edge 合法性與其他 graph invariants。
- Batch 核准必須在單一 transaction 中完成。
- 核准失敗時，不得有部分 nodes 或 edges 進入 canonical graph。
- MCP tools 與 resources 應以 batch 為 graph generation、review 與 approval 的主要單位。
