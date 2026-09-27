# Ticket graph identity 不建立產品意圖 Graph Revision

Ticket 是 canonical graph entity，但 Graph Revision 記錄的是 Product Brief Graph Draft Batch application。採用 ID 等於 Ticket ID、source/source_ref_type 為 ticket 的穩定 GraphNode；node 僅投影 Ticket aggregate 的 identity、title 與 lifecycle，Ticket creation／approval／archive 不推進 Graph Revision 或 Project reconciliation pointers。產品意圖 graph entities 仍必須有 created-in／last-changed provenance；Ticket-owned node／edge 使用 null，nullable edge 僅允許同 Project 的 Ticket endpoints。

以 Ticket INSERT 與 aggregate title／lifecycle UPDATE 的 SQLite triggers 維護投影，讓所有 aggregate writes 與投影同 transaction，避免 revision draft 誤改 title，也避免未來 archive writer 漏更新。Backfill 使用同一規則，graph slug 固定為 `ticket:<Ticket ID>`，不從 title 判斷 identity；ID 或 slug 衝突會中止 migration，而不猜測合併。Graph Draft Batch 只能修改產品意圖 ownership，Ticket source references 同樣只接受 active product-intent nodes，因此 projection 不進入 revision-based freshness。

拒絕為 Ticket writes 製造 Graph Revision，因其會錯誤使產品意圖 drafts stale；也拒絕把當前 Graph Revision 填作 Ticket provenance，因其並非建立 Ticket 的事件。獨立 Ticket-only graph tables 雖可保持既有欄位必填，但會把同一 canonical graph 拆成兩套讀取與 traversal。接受 nullable provenance 與 SQLite triggers 的明確儲存契約，換取單一 canonical graph 與不可分割的 aggregate projection。未來其他 adapter 必須提供同等 transaction 保證。

Forward migration 依 SQLite rebuild 流程，在 transaction 外暫停 FK、transaction 內完整搬移 graph tables 並執行 foreign_key_check，失敗 rollback，finally 恢復 FK ON；既有 indexes、外部引用與歷史資料必須保留。此決策不建立 Follow-up edge；lineage workflow 另行實作。
