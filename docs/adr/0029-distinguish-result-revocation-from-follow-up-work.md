# ADR 0029：區分 Result Revocation 與 Follow-up Work

## Status

Accepted

## Context

Ticket 成為 `done` 後，仍可能出現兩種性質不同的情況：一是原 Result Acceptance 在作成當時就建立在無效證據或錯誤判斷上；二是驗收後才出現新需求、regression，或發現原 acceptance criteria 未涵蓋的工作。

若兩種情況都直接 reopen 原 Ticket，系統無法分辨「原完成判斷無效」與「原工作已完成但後來出現新工作」。若一律建立新 Ticket，錯誤的 acceptance 又會繼續支撐不實的 `done` 狀態。

## Options Considered

### A：所有完成後問題都 Reopen 原 Ticket

優點：

- 操作模型簡單。
- 所有相關工作集中在同一 Ticket。

缺點：

- 混淆原 acceptance 無效與後續新增工作。
- 已完成規格的範圍與歷史會持續膨脹。
- 無法準確解釋 Ticket 為何從 `done` 回退。

### B：所有完成後問題都建立新 Ticket

優點：

- 原 Ticket 的 completion history 保持穩定。
- 後續工作有獨立範圍與驗收標準。

缺點：

- 即使原 acceptance 明確無效，原 Ticket 仍錯誤維持 `done`。
- 無法撤銷錯誤 acceptance 對目前狀態的效力。

### C：無效驗收使用 Result Revocation，新增工作建立 Follow-up Ticket

優點：

- 原 acceptance 無效時可修正目前 Delivery Status。
- 新工作不會改寫原 Ticket 的完成語意。
- Result、Acceptance、evidence 與後續工作都保有完整追溯。

缺點：

- 使用者必須判斷問題屬於原驗收錯誤或後續新增工作。
- Domain model、tools 與 audit log 需要額外的 revocation 概念。

## Decision

採用選項 C。

只有在 Result Acceptance 作成當時即無效時，才能執行 Result Revocation。典型情況包括測試證據無效、evidence 引用錯誤，或 acceptance criterion 當時實際未滿足。

任何仍有效、且對應 active approved Result 的 Result Acceptance 都可撤銷，不要求 Ticket 已是 `done`。Result Revocation 必須引用保存 Local Actor、時間與理由的 Decision node，並保存不可變的 previous／resulting Delivery Status；Revocation 不複製 Decision 的 reason、actor 或 time。操作必須 archive 對應的 Implementation Result。Ticket 若已是 `done`，必須退回 `in_progress` 或 `blocked`；若仍是 `planned`、`in_progress` 或 `blocked`，則保留原 Delivery Status，且 previous 與 resulting 相同。Archive Result、建立 revocation record，以及必要時更新 Delivery Status，必須在單一 transaction 中完成。

Revocation 不得刪除或改寫原 Implementation Result、Result Acceptance、Observed Evidence 或 audit records。它只撤銷該 approved Result 對目前 Implementation Target completion 的效力。

新需求、後續 regression 或原 acceptance criteria 未涵蓋的問題，不表示原 acceptance 無效。這類工作必須建立新的 Follow-up Ticket，透過 `traces_to` 關係連回原 Ticket；原 Ticket 維持 `done`。Follow-up Ticket 具有自己的 Ticket Revision、Implementation Targets、Implementation Results 與 Result Acceptances。

外部 work item 在原 Ticket 完成後被重新開啟時，系統不得自行假設屬於哪一類。它必須先建立 Sync Conflict，由使用者明確分類為原 acceptance 無效、新增工作或外部誤操作，再執行對應動作。

## Rationale

- `done` 必須能在驗收依據被證明無效時修正，不能保留已知錯誤的 canonical delivery state。
- 已完成範圍之外的新工作不應事後改變原 Ticket 的 completion semantics。
- 明確區分 revocation 與 follow-up work，可讓 graph 準確回答「原驗收是否有效」及「後續新增了什麼工作」。

## Trade-offs

- 接受完成後問題需要先分類，不能只提供通用 reopen 操作。
- 接受 Result Revocation 需要額外的 domain entity、tool 與 audit records。
- 接受 Follow-up Ticket 會增加 Ticket 數量，以換取清楚的工作範圍與歷史。

## Consequences

- Domain model 必須包含 Result Revocation 與 Follow-up Ticket。
- MCP 必須提供明確的 `revoke_result_acceptance` tool，且不得提供無理由的 generic reopen operation。
- Result Revocation 必須 archive active approved Result；Ticket 為 `done` 時更新為 `in_progress` 或 `blocked`，尚未完成時保留原 Delivery Status。
- Result Revocation 必須保存不可變的 previous／resulting Delivery Status，讓狀態 rollback 與無狀態變更的撤銷可直接區分。
- Result Revocation 的理由、actor 與時間只能保存在所引用 Decision，不得在 revocation record 複製。
- Result Revocation、Result Acceptance 與 Decision 必須屬於同一 Project，且 Revocation Decision 的 Project identity 不得為空。
- Result Revocation 必須保留原 Result、Acceptance、evidence 與 audit history。
- Ticket generation 必須支援以 `traces_to` 關係連結 Follow-up Ticket 與原 Ticket。
- 新需求、後續 regression 與原 criteria 未涵蓋的工作不得使用 Result Revocation。
- 外部 reopen 必須先建立 Sync Conflict 並由使用者分類，不得自動 Result Revocation 或建立 Follow-up Ticket。
- Audit log 必須區分 acceptance、revocation、Delivery Status rollback 與 Follow-up Ticket creation。
