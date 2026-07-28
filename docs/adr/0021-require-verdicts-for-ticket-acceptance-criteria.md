# ADR 0021：Ticket Acceptance Criteria 必須具有明確 Verdict

## Status

Accepted

## Context

ADR 0020 規定 Ticket 必須具有已接受的 Implementation Result 才能完成，但尚未定義 Result 如何表達每一項 acceptance criterion 的驗證結果，也未定義使用者是否能接受未完全滿足的條件。

如果 Result 只提供整體 pass／fail，無法知道哪些 criteria 已被驗證。如果把未驗證項目視為通過，`done` 會失去可信語意。另一方面，實際交付有時需要由使用者明確接受某項條件未完成；若沒有正式的例外機制，這類決策會消失在對話或被錯誤標為 passed。

## Options Considered

### A：只保存整體 Result 狀態

優點：

- Result schema 最簡單。
- Completion validation 容易實作。

缺點：

- 無法追溯每項 acceptance criterion 的證據與結論。
- 未驗證項目容易被整體成功狀態掩蓋。

### B：每項 Criterion 只有 Satisfied／Unsatisfied

優點：

- 每項條件都有明確結果。
- `done` 規則直接。

缺點：

- 無法表達使用者有意接受例外的情況。
- 使用者可能被迫把未滿足條件錯誤標成 satisfied。

### C：每項 Criterion 使用 Satisfied／Waived／Unsatisfied

優點：

- 每項 criterion 都有明確 verdict。
- Waiver 可保留例外理由與決策責任。
- `done` 可保持嚴格，同時支援明確的人類例外。

缺點：

- Completion model 與 UI 較複雜。
- Waiver 需要額外 Decision node 與 audit record。

## Decision

採用選項 C：Implementation Result 必須為 Ticket 的每一項 acceptance criterion 提供 `satisfied`、`waived` 或 `unsatisfied` verdict。缺少 verdict 的 criterion 視為未驗證。

Ticket 只有在所有 criteria 都是 `satisfied` 或 `waived` 時，才能執行 Result Acceptance 並把 Delivery Status 更新為 `done`。任何 `unsatisfied` 或未驗證 criterion 都必須阻止 completion，Ticket 維持 `in_progress` 或 `blocked`。

`waived` 只能由使用者明確設定，且必須包含具體理由。每個 Waiver 必須建立 `decision_type = acceptance_criterion_waiver` 的 Decision node 並留下 audit record；其他 Decision type 不得綁定到 waived outcome。Waiver 不得把 criterion 改寫或顯示為 `satisfied`。

## Rationale

- Criterion-level verdict 讓 completion 可被驗證與追溯。
- 明確區分 waived 與 satisfied，可保留交付事實與產品決策之間的差異。
- 缺少 verdict 時採 fail-closed 規則，避免未驗證內容被默認通過。

## Trade-offs

- 接受每個 Implementation Result 都必須逐項對應 acceptance criteria。
- 接受 waiver workflow 需要額外使用者操作。
- 接受有任何未驗證 criterion 時無法完成 Ticket。

## Consequences

- Implementation Result schema 必須包含每項 acceptance criterion 的 verdict 與 evidence reference。
- Result Acceptance validation 必須拒絕存在 `unsatisfied` 或缺少 verdict 的 Result。
- Waiver Decision 必須以 `summary`、`actor_id`、`created_at` 作為理由、使用者與時間的唯一權威來源；Outcome 只引用 Decision，不複製這些欄位。
- Waiver Decision 的 Project identity 必須非空，並與 Result Acceptance、Outcome、Verdict 及 Implementation Result 一致。
- Graph 必須建立 Waiver Decision 與對應 acceptance criterion、Ticket 及 Implementation Result 的關係。
- Resources 與 exports 必須清楚區分 satisfied、waived 與 unsatisfied，不得合併顯示為 passed。
