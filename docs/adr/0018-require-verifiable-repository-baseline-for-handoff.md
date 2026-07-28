# ADR 0018：Implementation Handoff 必須具有可驗證的 Repository Baseline

## Status

Accepted

## Context

ADR 0017 規定 Implementation Brief 必須綁定 Repository Context Snapshot，但尚未定義 snapshot 需要包含哪些最低識別資訊。

Repository summary、file list 或 module notes 可以協助 AI 產生實作計畫，但若沒有 repository identity 與確切程式碼版本，就無法判斷 brief 是否基於目前程式碼，也無法重現 coding agent 當時收到的背景。Uncommitted changes 也可能讓相同 commit SHA 對應到不同的實際工作內容。

ADR 0010 已決定第一版 MCP server 不直接掃描 local repository，因此 baseline 資料必須由 MCP client 或使用者提供。

## Options Considered

### A：不要求 Repository Baseline

優點：

- 任何文字形式的 repository context 都能快速進入 handoff。
- Client 不需要提供 Git metadata。

缺點：

- 無法可靠判斷 Implementation Brief 是否過時。
- 無法重建當時使用的程式碼背景。
- Coding agent 可能在錯誤版本上執行計畫。

### B：Baseline 為選填，缺少時只顯示警告

優點：

- 保留較低摩擦的 workflow。
- 有版本資訊時仍可提供較好追溯。

缺點：

- Approved handoff 的可信度不一致。
- Client 與 agent 必須處理「核准但不可驗證」的模糊狀態。

### C：Baseline 是 Implementation Brief 核准的必要條件

優點：

- 所有 approved handoffs 都具有一致的可驗證基準。
- 可以偵測 repository context 是否已過時。
- Code changes 與 pull requests 可追溯到明確程式碼版本。

缺點：

- Client 必須提供 repository identity 與 Git revision。
- Dirty working tree 需要額外保存 diff 或內容雜湊。
- 無版本資訊時只能停留在 draft。

## Decision

採用選項 C：Implementation Brief 核准前，其 Repository Context Snapshot 必須包含 repository identity 與 baseline commit SHA。

如果生成時使用尚未提交的變更，Snapshot 還必須保存相關 diff 或內容雜湊，使該 working state 可以被辨識。缺少上述 baseline 資料時，系統可以建立 draft Implementation Brief 供討論，但不得核准或交給 coding agent 執行。

MCP server 不直接掃描 repository。MCP client 或使用者負責提供 baseline 與 dirty-state 資料；server 負責保存、驗證必要欄位，並在 handoff 中回傳精確引用。

## Rationale

- Coding handoff 的可信度取決於產品規格與程式碼背景都可追溯。
- Hard approval gate 比可忽略的 warning 更能維持所有 approved briefs 的一致語意。
- 由 client 提供 repository metadata，符合 MCP-first 與 server 不直接掃描 local repository 的既有邊界。

## Trade-offs

- 接受無 Git baseline 的 repository context 不能進入 approved handoff。
- 接受 dirty working tree 需要額外擷取與保存資訊。
- 接受 client integration 必須承擔更多 context collection 責任。

## Consequences

- Repository Context Snapshot schema 必須要求 repository identity 與 baseline commit SHA 才能通過 approval validation。
- Snapshot 使用 uncommitted changes 時，必須包含相關 diff 或 content hash metadata。
- Implementation Brief approval tool 必須拒絕缺少可驗證 baseline 的 snapshot。
- Draft generation 仍可接受不完整 repository context，但輸出必須清楚維持 draft 狀態。
- Implementation Brief resources 必須暴露其精確 repository baseline。
