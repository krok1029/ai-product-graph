# ADR 0028：以 Implementation Targets 表達 Multi-Repository Work

## Status

Accepted

## Context

一個 Ticket 可能需要修改多個 Repositories。Repository Context Snapshot、baseline commit、dirty state、Implementation Brief、commits、pull requests 與 tests 都具有 repository-specific identity。

若單一 Implementation Brief 同時涵蓋多個 Repositories，就需要同時管理多個 baselines 與 freshness checks，任一 repository drift 都會使整份 handoff 模糊。另一個選項是強制每個 Repository 拆成獨立 Ticket，但這會失去跨 repositories 共同交付同一產品目標的單一工作 identity。

## Options Considered

### A：單一 Brief 涵蓋多個 Repositories

優點：

- Ticket 只有一份 handoff。
- 跨 repository 計畫可以放在同一文件。

缺點：

- 一份 brief 需要多個 baselines 與 dirty-state fingerprints。
- Freshness、supersession 與 result evidence 邊界不清楚。
- 某一 repository drift 會影響整份 handoff。

### B：每個 Repository 強制拆成獨立 Ticket

優點：

- 每張 Ticket 都只有單一 repository scope。
- Handoff 與 completion model 簡單。

缺點：

- 同一產品交付被拆成多個不具共同 identity 的 Tickets。
- 跨 repository completion 與依賴必須額外協調。

### C：Ticket Revision 包含 Required Implementation Targets

優點：

- Ticket 保留跨 repository 的單一工作 identity。
- 每個 target 仍有獨立 baseline、brief、result 與 freshness。
- Ticket completion 可以明確聚合所有 required targets。

缺點：

- Domain model 增加 Implementation Target 層。
- Completion validation 必須聚合多個 target results。

## Decision

採用選項 C：Ticket 具有一個或多個 repository-specific Implementation Targets。每個 Implementation Target 是 Ticket + Repository 組合下的穩定 identity，具有 Lifecycle Status，並對應單一 Repository；同一 Ticket 最多只能為同一 Repository 保有一個 active Target。

Ticket Revision 保存當版 required Implementation Target membership 與每個 target 的 scope。新版仍需要同一 Repository 時必須沿用 active Target identity，scope 變更只存在新的 immutable Ticket Revision，不得直接修改 Target。

每個 target 必須有獨立的 Repository Context Snapshot、Implementation Brief 與 accepted Implementation Result。單一 Implementation Brief 不得跨 Repositories，且同一 target 最多只能有一份 active approved brief。

Implementation Result 與 Result Acceptance 綁定精確 target 與 Ticket Revision。新版 Ticket Revision 即使沿用 Target identity，也不得自動沿用舊 revision 的 accepted results；可以重用 evidence references，但必須建立並接受新的 Result。

Ticket 只有在目前 approved Ticket Revision 的所有 required Implementation Targets 都具有 accepted Implementation Result，且符合 acceptance criteria verdict 規則時，Delivery Status 才能更新為 `done`。

任何 replacement Ticket Revision 核准時，Delivery Status 必須重設為 `planned`。沿用相同 Target identities 不表示沿用舊 revision 的執行進度或 accepted results。

同一 approval transaction 必須 archive 綁定舊 revision 的 active Implementation Briefs 與 Results，即使 Target identity 沿用。Archived artifacts 保留 Review Status、Acceptances、evidence 與 target lineage。

若沿用 Target 的舊 brief 在新版 approval 後才提交 Result，valid repository evidence 仍保存，但 Result 必須標記 stale 並 archived，不得 acceptance。新 revision 可重用 evidence，但必須建立新 brief、verdicts 與 acceptance。

Implementation Target membership 與 scope 是 Ticket specification 的一部分。增加、移除或更換 target 必須建立新的 Ticket Revision，不能直接修改 approved revision。核准新版時，移除 Repository 必須 archive 對應 Target，並為 active repository-specific External Work Item mappings 建立 close Sync Intents。日後重新加入已移除 Repository 時建立新 Target identity，不得 unarchive 舊 Target。

Repository-specific External Work Item（例如 GitHub Issue）必須映射到單一 Implementation Target，而不是直接代表可能跨 repositories 的整張 Ticket。Product／project management work item（例如 Plane）則映射到 Ticket，提供跨 targets 的整體規劃視角。

## Rationale

- Repository baseline 與 code evidence 天然是 repository-specific。
- Target 層能在不拆散 Ticket identity 的情況下維持精確 handoff boundaries。
- Required target aggregation 讓 multi-repository `done` 具有可驗證語意。

## Trade-offs

- 接受 Ticket schema 與 workflow 增加一層 entity。
- 接受每個 Repository 都需要獨立 brief review 與 result acceptance。
- 接受任一 required target 未完成時，整張 Ticket 不能標為 `done`。

## Consequences

- Domain model 與 storage 必須包含 Implementation Target。
- Implementation Target 必須由 Ticket + Repository 穩定識別，且同一組合最多一個 active identity。
- Ticket Revision schema 必須包含至少一個 required target membership 與 per-revision scope，並限制 repository identity 不重複。
- Ticket Revision approval 必須 reuse same-repository active Target、archive removed Targets，並為相關 mappings 建立 close Sync Intents。
- Replacement Ticket Revision approval 必須把 Ticket Delivery Status 重設為 `planned`，不因 Target identity 沿用而保留舊進度。
- Replacement revision 必須 archive 舊 revision 的 active Briefs 與 Results，解除同一 Target 的 active uniqueness conflicts。
- Same-target late Result 必須保存 evidence 但 archive stale Result；不得因 identity 沿用而接受舊 revision result。
- Archived Target 不得直接 reactivated；重新加入相同 Repository 時建立新 identity。
- Implementation Brief 必須引用 `implementation_target_id`，而不是只引用 Ticket Revision。
- Repository Context Snapshot identity 必須符合 target Repository。
- Implementation Result 透過 brief 對應單一 target。
- Ticket completion query 必須驗證所有 required targets 都有 accepted results。
- GitHub Issue 等 repository-specific External Work Item 必須連到單一 Implementation Target。
- Plane 等 product／project-level External Work Item 可以連到 Ticket，聚合多個 targets。
