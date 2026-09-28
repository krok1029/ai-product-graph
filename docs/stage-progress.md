# 階段進度投影

`get_graph_context` 的 `delivery.stage_progress` 按 Milestone → Spec 列出工作，供 agent 解釋目前進度。資料由既有規劃、Ticket Revision 與交付結果衍生，沒有新增工具、資料表或手動階段狀態。

## 範圍與讀法

- `scope = active_project_tickets`：涵蓋整個 Project 的 active Tickets，不受 `node_types`、`max_depth`、`lifecycle_status` 圖譜顯示篩選縮限。
- `milestones` 包含所有 active Milestones，按 sequence、identity 排序。`specs` 保留空規格，空階段也會列出。
- 每個群組包含 `ticket_ids` 和 `summary`。以 identity 分組，同名階段不合併；每票只能出現在一個 Spec，否則進入 `ungrouped`。
- Ticket 的完整阻塞原因、待接受結果、evidence 缺口與 `next_action` 沿用同一份 `delivery.tickets`，用 `ticket_id` 對照，沒有另一套推論。
- `ungrouped_specs` 保留沒有有效 active Milestone 關係的 active Specs，避免異常舊資料在摘要中消失。

## 核准來源與未歸組

分組只使用 Ticket 的 current active approved revision，不採用尚未核准的新草稿、標題相似度或歷史 Ticket edge。核准 revision 所引用的 Spec → Milestone → Product Brief 身分，必須仍對應目前 active 的節點及 `belongs_to` 關係。關係的建立及最後變更 Graph Revision 必須可查證，且不晚於 Ticket 的 source Graph Revision；不能把額外引用的 Milestone 當成核准父歸屬。新建的父關係表示歸屬已變；缺少歷史版本或無法證明既有關係未變時保守列為未歸組，不新增 schema 或猜測舊來源。

Spec 內容改變但來源身分未變，Ticket 留在同一群組並呈現 `stale`。父來源尚待重新確認也是 freshness 問題，不能藉此隱藏已存在的工作。Spec 移到新 Milestone 而核准 ancestry 未更新時，Ticket 進入 `ungrouped`；核准替代 revision 後才重新分組。

`ungrouped.tickets` 保存 `ticket_id`、`source_spec_id` 與下列原因：

| reason | 意義 |
| --- | --- |
| `unapproved_ticket` | 沒有可讀取的目前核准 revision |
| `invalid_approved_revision` | 核准指標指向非 active approved、非本票或跨專案 revision |
| `legacy_without_spec` | 舊 Ticket 沒有 Spec 來源 |
| `source_spec_missing` / `source_spec_archived` / `source_spec_invalid` | 來源 Spec 缺失、封存或型別不符 |
| `source_ancestry_missing` / `source_ancestry_archived` / `source_ancestry_invalid` | 祖先缺失、封存或關係／型別不符 |
| `approved_ancestry_changed` | 現在的 ancestry 不在核准來源中，或父關係在核准來源版本後才建立 |
| `approved_ancestry_unverifiable` | 缺少關係歷史版本，或關係之後曾變更而無法證明核准時父歸屬 |

## 計數與完成邊界

`summary.delivery_status_counts` 的 planned／in_progress／blocked／done 是互斥的交付狀態；`source_freshness_counts` 的 current／stale／unapproved 是另一個獨立軸。

既有 summary 欄位維持意義：`done` 是歷史交付狀態，`stale` 是來源新鮮度，`blocked` 包含 Ticket 明示 blocked 或尚未完成的相依工作，`awaiting_acceptance` 表示至少一個 target 有目前 revision 的待接受結果。一張票可以同時 done、stale 或 awaiting_acceptance；這些數字不能加總當成工作總數。待接受也不表示結果已通過所有接受條件。

Milestone 顯示原有 `outcome`、`sequence`、`exit_criteria`，`completion` 固定為 `not_evaluated`。全票 done、零張票或測試通過都不等於退出條件已滿足。這個唯讀投影不自動接受結果、不撤銷舊驗收，也不宣告 Milestone 完成。

## 驗證

MCP 行為測試涵蓋圖譜篩選、同名與空階段、空 Spec、核准前後來源變更、待接受結果、相依阻塞、done/stale 重疊、封存、legacy、缺失來源與查詢無寫入。

本票採取的可調整決定：群組只放 Ticket identities，完整診斷集中在既有 `delivery.tickets`，避免兩份資料失去一致性；結構仍一致的 stale 工作留在原群組，結構與核准 ancestry 不符的工作明列未歸組。上述決定保留供本機流程收尾後審查。
