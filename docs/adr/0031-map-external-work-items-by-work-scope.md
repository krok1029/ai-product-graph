# ADR 0031：依工作範圍映射 External Work Items

## Status

Accepted

## Context

Ticket 可以包含多個 repository-specific Implementation Targets。Plane 等產品／專案管理工具通常以整體工作單位管理規劃與進度；GitHub Issues 等 repository-scoped trackers 則天然隸屬於單一 Repository。

若所有 External Work Items 都直接映射到 Ticket，multi-repository Ticket 的單一 GitHub Issue 無法準確表示它屬於哪個 Repository、Implementation Brief、PR 與 Result。若所有 External Work Items 都映射到 Implementation Target，Plane 中又會失去跨 repositories 的整體工作視角。

## Options Considered

### A：所有 External Work Items 都映射到 Ticket

優點：

- 每張 Ticket 在每個外部工具中只有一個整體工作項目。
- Mapping model 最簡單。

缺點：

- Repository-specific issue 可能橫跨多個 Repositories。
- Issue、PR、Implementation Brief 與 Result 的 target 邊界不清楚。
- 單一 target 的工程進度難以獨立追溯。

### B：所有 External Work Items 都映射到 Implementation Target

優點：

- 每個外部工作項目都有明確 repository scope。
- 工程 artifacts 可以直接連到 target。

缺點：

- Plane 等 PM 工具會把一張跨 repository Ticket 拆成多個 work items。
- 缺少產品／專案層級的整體規劃與進度視角。

### C：依外部工作的 Scope 選擇 Owner

優點：

- Product／project management item 保留 Ticket 層級視角。
- Repository-specific item 保留精確 target 與 Repository 邊界。
- Multi-repository Ticket 可以同時聚合規劃與工程追溯。

缺點：

- External Work Item mapping 必須支援兩種 owner type。
- Adapter 必須宣告自己匯出的工作範圍。

## Decision

採用選項 C。

Plane 等 product／project management External Work Item 必須映射到 Ticket。它代表跨 Implementation Targets 的整體規劃工作，不直接綁定單一 Repository。

GitHub Issue 等 repository-specific External Work Item 必須映射到單一 Implementation Target，且存在於該 target 所對應的 Repository。它不得橫跨多個 targets 或 Repositories。

Implementation Target 是 Ticket + Repository 下跨 Ticket Revisions 穩定的 identity。新版 revision 沿用同一 Repository 時，既有 GitHub Issue mapping 保持不變並同步新版 scope；移除 Repository 時 archive Target 並建立 close intent。日後重新加入時建立新 Target identity 與新 mapping，不得重新綁定 archived mapping。

External Work Item 透過 graph 的 `traces_to` 關係連到其內部 owner。Multi-repository Ticket 因此可以有一個 Ticket-level Plane work item，以及每個 Implementation Target 各自 repository 中的 GitHub Issue。

Pull Request、changed files、tests 與其他 repository evidence 應先連到 Implementation Target，再沿 target 關係追溯到 Ticket，不應只依賴 Ticket-level External Work Item。

External Container 由 provider、外部 workspace／account identity 與 container identity 組成，例如 Plane project 或 GitHub repository。同一 internal owner 在同一 External Container 最多只能有一個 active External Work Item；不同 providers 或 containers 可以各自建立 active mapping。

首次建立 External Work Item 必須由使用者明確選擇 internal owner 與 External Container，不因 approval 自動建立。Active mapping 建立後，才自動 enrollment 後續 approved revisions 與適用狀態變更。MVP 不提供 Project-level auto-export policy。

First export 只能使用 Ticket 的 current approved revision。Plane item 從該 revision 投影；GitHub Issue 必須從該 revision 中 active 且 repository-matched Implementation Target 投影。Create Sync Intent 必須保存精確 source revision ID。Draft 不得建立 External Work Item。

External Work Item identity 不得原地改綁到不同 internal owner 或 external reference。外部項目被替換時，必須 archive 舊 mapping 並建立新 mapping，以保留匯出與同步歷史。

Replacement 必須先成功建立新的 external item；internal transaction 再 archive 舊 mapping 並建立新的 active mapping，避免同一 owner 與 External Container 同時出現兩個 active mappings。若不再 replacement，使用者必須以 Decision 明確 terminate 並 archive 舊 mapping。

External Work Item 的 title、description、acceptance criteria 與其他 specification content 只能先保存為 immutable snapshot。若與 internal owner 的 approved Ticket Revision 不同，必須建立 Content Drift；採用外部內容時建立新的 Ticket Revision Draft，不得直接修改 approved specification。

每個 adapter contract 必須宣告 adapter-managed 與 external-only fields。Outbound sync 只能在外部 concurrency token 符合最後同步 snapshot 時更新 managed fields；external-only 與未宣告欄位不得修改。

Ticket-level 與 target-level External Work Items 必須各自同步。每個 mapping 具有獨立 Sync Attempt 與 retry；任一 provider 或 container 失敗，不得回滾其他 mappings 或 internal approval。

## Rationale

- 外部 mapping 的粒度應符合外部工具實際承載的工作範圍。
- Implementation Target 已提供 repository-specific handoff、result 與 completion boundary，repository issue 應沿用同一邊界。
- Ticket-level PM item 可保留使用者理解整體產品交付的單一入口。

## Trade-offs

- 接受 External Work Item 需要 polymorphic owner 或等價的明確 mapping constraints。
- 接受 multi-repository Ticket 可能在多個外部工具中產生多個 work items。
- 接受 adapter 開發者必須區分 product／project scope 與 repository scope。
- 接受 replacement 會建立新 mapping identity，而不是重用舊 record。

## Consequences

- Domain model 必須允許 External Work Item 映射到 Ticket 或 Implementation Target，但不能同時映射兩者。
- Plane adapter 必須以 Ticket 作為 export 與 sync owner。
- GitHub Issue adapter 必須以 Implementation Target 作為 export 與 sync owner。
- Same-repository Ticket Revision 必須沿用 active Target 與其 GitHub mapping；removed Target 必須 close mapping，re-added Repository 使用新 identity。
- GitHub Issue 所在 Repository 必須符合 Implementation Target 的 Repository identity。
- Graph 必須以 `traces_to` 保存 External Work Item 與正確 owner 的關係。
- Storage 必須強制同一 internal owner 與 External Container 的 active mapping 唯一性。
- First export 必須是明確使用者操作；active mapping 才觸發後續自動 Sync Intents。
- First export 必須綁定 current approved Ticket Revision；draft 與非 current revision 必須拒絕。
- Repository-specific export 必須驗證 target 與 External Container Repository identity 相符。
- External Work Item replacement 必須 archive 舊 mapping 並建立新 mapping，不得改綁既有 identity。
- Replacement activation 必須與 archive 舊 mapping 原子完成；termination 必須記錄使用者 Decision。
- External content ingestion 必須建立 immutable snapshots；Content Drift resolution 才能產生新的 Ticket Revision Draft。
- Adapter contract 必須宣告 field ownership，且 outbound updates 必須受 snapshot concurrency token 保護。
- 每個 External Work Item mapping 必須具有獨立、可冪等重試的 Sync Attempts。
- Ticket context query 必須能聚合 Ticket-level work items 與所有 targets 的 repository-specific work items。
- Integration tests 必須涵蓋 multi-repository Ticket 的一個 Plane item 與多個 target-specific GitHub Issues。
