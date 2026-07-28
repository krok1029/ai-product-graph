# ADR 0002：整合現有 PM 工具，而不是重做 PM

## Status

Proposed

## Context

這個產品想法和 project management 有重疊，但 GitHub Issues、Plane、Linear、OpenProject 等成熟工具已經處理很多 PM workflow。

更強的產品機會是 AI context 和 traceability layer。

## Decision

MVP 不嘗試取代 project management tools。

它會：

- 擁有 Product Brief 和 Project Knowledge Graph。
- 生成 tickets。
- 匯出或同步 tickets 到外部工具。
- 把外部 issues、PRs、files 和 tests 連回 graph nodes。

External Work Item 是內部 Ticket 的同步投影，不是 Ticket 本身。外部系統可同步一般工作進度，但外部 closed／done 不構成 Result Acceptance，不能直接把內部 Ticket 標為 `done`。內部 Ticket 完成後可以向外同步關閉 work item。

## Consequences

Benefits：

- MVP 更快。
- 差異化更清楚。
- 既有團隊更容易採用。
- 不需要重做 boards、permissions、comments 和 notifications。

Trade-offs：

- 外部整合會增加複雜度。
- 部分 workflow 會依賴第三方工具 API。
- 未來需要處理 sync conflicts。
- 外部工具無法單獨決定內部 Ticket 的完成狀態。

## Revisit When

- 使用者更偏好 native ticket board。
- 外部 sync 不可靠。
- 市場明確要求完整整合式 PM 表面。
