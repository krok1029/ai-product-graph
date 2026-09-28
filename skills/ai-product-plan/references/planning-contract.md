# 規劃資料契約

正式層級為 `Product Brief → Milestone → Spec → Ticket`。`save_planning_node` 是內容與圖譜的單一寫入入口；不另外建立／核准 Graph Draft Batch。

先以 `get_graph_context` 取得 `graph_revision_id`。每次寫入的 `base_graph_revision_id` 必須是當前版本，後續改用保存結果的 `graph_revision.id`。

```json
{
  "project_id": "project-id",
  "base_graph_revision_id": "current-revision-id",
  "change": {
    "operation": "save",
    "title": "MVP：完成一次計時",
    "document": {
      "type": "milestone",
      "content": {
        "outcome": "使用者可完成一次運動計時",
        "exit_criteria": ["可以開始、暫停、繼續與結束"],
        "sequence": 1,
        "scope": ["單一計時模式"],
        "non_goals": ["雲端同步"]
      }
    }
  }
}
```

Milestone 的 parent 預設為目前 Brief 圖譜根節點。更新加上 `change.node_id`；Milestone 和 Spec 都不能改 type 或跨 Project 移動。不要更改原 identity。

Spec 使用同一個 envelope，`change.parent_node_id` 指定 Milestone ID，`document` 為：

```json
{
  "type": "spec",
  "content": {
    "problem_statement": "使用者無法中途暫停",
    "solution": "提供可繼續的暫停控制",
    "user_stories": ["作為使用者，我想暫停並繼續，以便臨時休息"],
    "implementation_decisions": ["以同一計時狀態管理控制行為"],
    "testing_decisions": ["從控制輸入驗證剩餘時間與狀態"],
    "out_of_scope": ["跨裝置接續"],
    "further_notes": []
  }
}
```

以上是欄位範例；實際 user stories 要完整涵蓋規格內的能力與邊界。Ticket 的 `source_spec_id` 填保存回傳的 Spec node ID。`related_graph_node_ids` 可填其他產品來源或空陣列；server 會加入完整三層 ancestry。

封存用 `change: { "operation": "archive", "node_id": "..." }`。封存 Milestone 會連帶封存所屬 Specs 與關係，受影響 Ticket 保留歷史且無法用過期來源開工。

`planning.stale_node_ids` 表示需要重新比對上游的規劃節點；`affected_ticket_ids` 列出已核准但來源變動的 Tickets。MVP 完成度仍依 Ticket Acceptance，Milestone／Spec 不因保存而表示完成。

每次保存仍產生 Graph Revision；`metadata.content_revision_id` 只在標題、描述、內容或父歸屬改變時前進。重新比對後，內容仍適用就保存同一內容，更新父來源確認且保留內容版本，再讀影響清單。不要僅因上游多一次保存就建立新 Ticket Revision。舊資料沒有內容版本時採最後 Graph Revision，不推測舊內容相等。

`get_graph_context.delivery` 提供全專案 active Tickets 的完成／stale／blocked／待接受摘要及逐 target 證據缺口。用它解釋受影響範圍與下一步；詳細 `pending_result` 可從 `get_work_context` 取得。這些是唯讀提示，不能當成自動驗收。
