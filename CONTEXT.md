# AI Product Graph

AI Product Graph 是一個 MCP-first 的產品規劃系統，用來把模糊的產品想法轉成可追溯的 Product Brief、產品知識圖譜、tickets 與 implementation handoffs。

## Language

**Project**:
產品規劃工作區，包含 ideas、Product Briefs、graph nodes、tickets 與 implementation handoffs。Project 可以關聯一個或多個 Repository，但不等同於程式碼儲存庫。
_Avoid_: Repo, repository, codebase

**Repository**:
與 Project 相關的程式碼儲存庫，用來提供 implementation handoff 所需的程式碼脈絡或外部整合參照。Repository 不擁有產品規劃資料。
_Avoid_: Project, workspace

**Product Brief**:
Project 中代表產品意圖的穩定 aggregate identity。MVP 每個 Project 只有一個 Product Brief；Product Brief 只具有 Lifecycle Status，不具有 Review Status，並指向目前 approved Product Brief Version。產品意圖改變時，應先建立並核准新版，再同步更新 graph 與 tickets。
_Avoid_: Markdown brief 作為正式資料、直接修改衍生資料來改變產品意圖

**Product Brief Version**:
Product Brief 內容的不可變版本，具有 Review Status 與 Lifecycle Status，並記錄建立時的 `base_approved_version_id`。Approved Product Brief Version 是 Project 產品意圖的權威來源，優先於由它衍生的 graph 與 tickets；核准時 base 必須仍等於 Product Brief 的 current approved version pointer，否則回傳 conflict。第一版可使用 `null` base。每次成功核准只更新 current pointer，舊版本保留。結構化 JSON 是正式資料，Markdown 只用於閱讀、審查與交接。
_Avoid_: 原地修改 approved version、把 Product Brief aggregate 當成內容版本

**Approval**:
由使用者對特定 draft 版本執行的明確核准動作。Approval 必須記錄核准者、核准時間與版本；聊天中的肯定、後續操作或 agent 的判斷都不構成 Approval。已核准的 Product Brief 不可直接改寫，任何變更都必須產生新的 draft。
_Avoid_: implicit approval, auto-approval, 修改 approved 版本

**Review Status**:
需要人類審查的內容所具有的狀態，只能是 `draft` 或 `approved`。Product Brief Version、AI interpretations、Graph Draft Batch、Ticket revisions、Implementation Brief 與 Implementation Result 等具有 Review Status；原始來源紀錄、穩定 aggregate identities 與 Observed Evidence 沒有 Review Status。
_Avoid_: archived、delivery progress、套用到所有 entities

**Lifecycle Status**:
所有 entities 是否仍在目前有效範圍內的狀態，只能是 `active` 或 `archived`。Lifecycle Status 與 Review Status、Delivery Status、Handoff Freshness 彼此獨立。
_Avoid_: draft、approved、planned、done、stale

**Graph Draft Batch**:
由 AI 依據單一已核准 Product Brief 版本，在同一次萃取中產生的一組候選 graph 變更。每個 batch 固定生成時的 `base_graph_revision_id`；approval 時必須等於 Project 的 current Graph Revision，否則回傳 conflict，不得自動 merge。Graph 尚無 revision 時，第一個 batch 的 base 可以是 `null`。Review Status 屬於整個 batch；batch 內的 proposed nodes、edges 與 changes 不是各自具有 Review Status 的 canonical graph entities。對既有 canonical graph，batch 必須明確列出要新增、更新或封存的產品規劃 nodes 與 edges，不得整張替換或盲目追加；若比較後無須修改 graph，batch 可保留空 changes，但必須包含 `reconciliation_summary` 並由使用者明確核准。核准 Product Brief 不會自動核准 Graph Draft Batch；使用者必須審查並整批核准，確保變更以一致且完整的集合原子套用。核准後建立或更新的 canonical GraphNodes 與 GraphEdges 只具有 Lifecycle Status；no-op batch 核准不修改任何 GraphNode 或 GraphEdge。Repository、code file、pull request 等實作追蹤資料不屬於 Product Brief 萃取的修改範圍；無法確定實體身分時必須標示衝突，由使用者解決。
_Avoid_: stale batch 套用、自動 merge、自動核准 AI 萃取結果、逐一核准 batch 內的變更、整張替換、盲目追加、自動合併身分不明的實體、沒有審查紀錄就解除 reconciliation pending

**Graph Revision**:
每次 Graph Draft Batch 成功原子套用後建立的不可變 graph application record，具有 Project 內單調遞增的 sequence number，並記錄該 batch 的 `source_product_brief_version_id`。No-op Graph Draft Batch 也會建立 Graph Revision，用來證明某個 Product Brief Version 已完成 graph reconciliation 但沒有 entity 變更。產品意圖 ownership 的 GraphNode 與 GraphEdge 記錄建立及最近變更所在的 Graph Revision；Ticket-owned graph entity 的變更屬於 Ticket 生命週期，不構成產品意圖 Graph Revision。Ticket Revision 記錄核准時的 source Graph Revision。若引用 entity 的 last-changed revision 晚於 Ticket Revision 的 source revision，該 Ticket Revision 的來源已變更。
_Avoid_: 完整 graph snapshot、event sourcing、以 updated_at 推測變更順序

**Product Intent Reconciliation**:
Project 目前 approved Product Brief Version 與已核准 product-intent Graph Revision 之間的衍生對齊狀態。Project 保存 `last_reconciled_product_brief_version_id` 與 `product_intent_graph_revision_id`；只有前者等於 Product Brief current approved version pointer 時，狀態才是 `current`，否則為 `pending`。新版 Product Brief Version 核准後立即成為權威產品意圖，但不預先 archive 或重設所有衍生 Tickets；在對應 Graph Draft Batch 核准前，handoff 必須以 `STALE_HANDOFF`／`product_intent_unreconciled` 阻擋，Result submission 只能保存 evidence 與 archived stale Result，Result Acceptance 也必須拒絕。Graph reconciliation 可透過有變更 batch 或 no-op batch 完成；no-op batch 表示已比較且確認無須變更 graph。Graph reconciliation 完成後，仍 active 且自 Ticket Revision source Graph Revision 後未變更的 referenced nodes 不影響既有 Ticket Revision；被更新或 archived 的 referenced nodes 才要求建立 replacement Ticket Revision。
_Avoid_: Product Brief approval 後仍交付未對齊 graph、只因 current pointer 改變就全面失效、在 graph reconciliation 前猜測受影響 Tickets

**Ticket**:
AI Product Graph 內部具有穩定 identity 的可執行規劃單位，也是 canonical graph entity；graph 中的 Ticket 與規劃 Ticket 是同一 identity，其 title 與 lifecycle 以 Ticket 為準。Ticket 只具有 Lifecycle Status 與 Delivery Status，不具有 Review Status；被審查的是 Ticket Revision。第一個 approved Ticket Revision 讓 Ticket 可用於規劃與 handoff。Ticket 必須能追溯到產品意圖，例如 product goal、pain point 或 workflow；它不等同於任何外部專案管理或程式碼託管系統中的工作項目。
_Avoid_: GitHub Issue, Plane issue, external ticket

**External Work Item**:
Plane、GitHub 或其他外部系統中的同步投影，具有獨立且不可改綁的 identity、external status 與 lifecycle，不是內部 Ticket 或 Implementation Target 本身。產品／專案管理範圍的 work item（例如 Plane）透過 `traces_to` 連到 Ticket；repository-specific work item（例如 GitHub Issue）則連到單一 Implementation Target。因此 multi-repository Ticket 可有一個 Ticket-level Plane item，並為每個 repository target 各有 GitHub Issue。同一內部 owner 在同一 External Container 最多只能有一個 active External Work Item；不同 providers 或 containers 可各自具有 active mapping。首次建立 external item 與 mapping 必須由使用者明確觸發，不因 Ticket Revision approval 自動匯出；active mapping 同時代表後續 approved revisions 與狀態變更已 enrolled 自動同步。外部項目被替換時必須 archive 舊 mapping 並建立新 identity，不得直接改寫 external reference 或 owner。外部狀態可同步內部 Ticket 的 `planned`、`in_progress` 或 `blocked`，但外部 closed／done 只能更新 External Work Item；它不是 Result Acceptance，不得把內部 Ticket 標為 `done`。內部 Ticket 經 Result Acceptance 完成後，可再向外同步關閉相關 work items。所有 inbound 與 outbound status sync 都必須記錄來源與 audit event。
_Avoid_: Ticket、Implementation Target、把外部 item ID 當作內部 identity、同一 container 的重複 active mapping、改綁既有 mapping、讓 repository issue 跨多個 targets、以外部 closed 繞過 Result Acceptance、混用 external status 與 Delivery Status

**External Container**:
外部工作項目所在的穩定命名範圍，由 provider、外部 workspace／account identity 與 container identity 組成；例如特定 Plane workspace 中的 project，或特定 GitHub account／organization 中的 repository。External Work Item mapping 的唯一性以 `internal_owner + provider + workspace + container` 判定，不能只用顯示名稱或 URL 推測。
_Avoid_: provider 名稱本身、可變 display name、未區分 workspace 的 project slug、未區分 account 的 repository name

**External Export Policy**:
決定何時為尚無 mapping 的 internal owner 建立第一個 External Work Item。MVP 固定採 `manual_first_export`：Ticket 或 Implementation Target approval 不會自動建立 external item，必須由使用者明確選擇 owner 與 External Container 並執行首次 export。首次 export 只能使用 Ticket 的 current approved revision；Plane item 從該 revision 投影，GitHub Issue 只能從該 revision 中 active、repository-matched Implementation Target 投影。Create Sync Intent 必須保存精確 `source_ticket_revision_id`。Draft 只可輸出 Markdown 預覽，不得建立 External Work Item 或 mapping。Mapping 成為 active 後，後續 approved revisions 與適用的狀態變更自動建立 Sync Intents。Project-level auto-export policy 延後至 integration workflow 被驗證後再評估。
_Avoid_: approval 即大量建立 issues、連線 container 等於自動匯出所有 Tickets、匯出 draft、從非 current revision 建立 mapping、每次 revision 都要求重新 enrollment

**External Work Item Snapshot**:
Adapter 每次讀取 External Work Item 時保存的不可變來源紀錄，包含外部 item identity、內容、external status、外部 version／ETag／updated timestamp 等 concurrency token、擷取時間與來源。Snapshot 沒有 Review Status，只表示外部系統當時回傳的內容；它不得直接修改 approved Ticket Revision 或 Implementation Target specification。Outbound content sync 前必須確認目前外部 concurrency token 仍等於最後同步 snapshot；不相等或無法驗證時建立 Content Drift 並停止覆蓋。成功同步後建立新 snapshot，不改寫舊 snapshot。
_Avoid_: canonical Ticket specification、直接回寫來源、只保存最新內容而覆蓋歷史、把外部更新時間當作內部 approval、未檢查 snapshot 就覆蓋

**External Field Ownership**:
每個 adapter contract 對 External Work Item 欄位的明確分類。Adapter-managed fields（例如由 Ticket Revision 投影的 title、description、acceptance criteria）可在 snapshot concurrency check 成功後由內部更新；external-only fields（例如 labels、assignees、comments）由外部工具管理，outbound content sync 不得修改。未宣告或無法分類的欄位預設視為 external-only。
_Avoid_: 整筆 replace 外部 item、依目前值猜測 ownership、覆蓋 labels／assignees／comments、未宣告欄位預設可寫

**Sync Attempt**:
針對單一 External Work Item 執行一次 inbound 或 outbound 同步的持久化操作紀錄，包含 internal source revision／event、目標 External Work Item、operation type、payload hash、穩定 idempotency key、開始與完成時間、結果及錯誤。不同外部項目的 attempts 彼此獨立；partial failure 不得回滾內部 approval 或其他已成功的外部同步。Retry 必須沿用同一 logical operation 的 idempotency key，並保留每次執行結果，避免重複建立或重複套用外部變更。
_Avoid_: 跨 providers 的 distributed transaction、失敗時撤銷內部 approval、無 idempotency key 的 retry、覆蓋先前錯誤紀錄

**Sync Intent**:
內部 domain transaction 決定需要對單一 External Work Item 執行外部副作用時，在同一 SQLite／application transaction 寫入的 immutable durable outbox record。Intent 固定 internal source revision／event、target mapping 或 External Container、per-mapping sequence、operation、payload hash 與 stable idempotency key；approval 成功只保證 domain state 與 intents 已一起提交，不等待外部 API。Commit 後的同步程序消費 intents 並建立 Sync Attempts；服務重啟後必須能繼續處理尚無成功 attempt 的 intents。同一 mapping 若在舊 content-update intent 尚未開始前產生新版 update，新 intent 可用 `supersedes_sync_intent_id` 指向舊 intent，只送出最新內容；舊 intent 保留且是否被 supersede 由有效的 immutable supersession 關係衍生；這項歷史關係不因新 intent 開始、完成或不再是最新 desired content 而失效。只有從未有 attempt 的 target 可據此省略。已開始的 update 必須先成為 terminal；若失敗，較新 content intent 可直接取代其 retry requirement，不必先重試舊內容。Create、close、reopen 等 lifecycle intents 不得被 content coalescing 或新版內容省略；failed lifecycle intent 是 per-mapping ordering barrier，必須先成功或明確解決後才能處理後續 intents。
_Avoid_: transaction 內呼叫外部 API、記憶體 queue、approval 成功但 intent 未保存、服務重啟後遺失 pending sync、刪除被合併 intent、跨 lifecycle operation 合併、同一 mapping 並行寫入

**Sync Health**:
Internal owner 相對於最新應同步 revision／event，在所有 active External Work Items 上的衍生同步健康度，只能是 `current`、`pending` 或 `failed`。最新 content intent 與所有不可省略的 lifecycle intents 已有成功 attempt 時為 `current`；仍有尚未完成的必要 intent／attempt 時為 `pending`；任一必要 lifecycle intent 或最新 desired content intent 的 latest attempt 已失敗且尚未解決時為 `failed`。已被較新 content intent supersede 的 pending 或 terminal-failed update 不影響目前 health。Approval 建立 intents 後可立即回傳成功與 `pending`。Sync Health 不可手動設定，也不影響內部 approval、Review Status、Lifecycle Status 或 Delivery Status。
_Avoid_: canonical workflow status、手動切換、以 failed 撤銷 approval、把歷史 attempt failure 永久視為目前 failed

**Sync Mapping Termination**:
External Work Item mapping 因外部項目被刪除、權限永久撤銷或 provider 不再使用而無法繼續同步時，由使用者作成的明確終止決策。Termination 必須記錄 Local Actor、時間、理由與 Decision node，archive mapping，並把其未完成 intents 記為因 mapping termination 而不再執行；不得把 failed intent 或 attempt 改寫為成功。Mapping、intents、attempts、snapshots 與 errors 全部保留。Archived mapping 才會從目前 Sync Health 計算排除。若採 replacement，新的 external item 必須先成功建立；internal transaction 再原子 archive 舊 mapping 並建立新的 active mapping，以維持同一 External Container 的 active mapping 唯一性。
_Avoid_: silent skip、把 abandoned 標成 succeeded、刪除 failure history、mapping 尚 active 就排除 health、同一 container 同時存在兩個 active mappings

**Content Drift**:
External Work Item Snapshot 的 title、description、acceptance criteria 或其他 adapter-managed specification content，與其 internal owner 目前 approved Ticket Revision 不一致，或 outbound sync 無法證明外部內容自最後 snapshot 後未變時，建立的不可變偵測紀錄。Drift 本身不得修改 approved specification 或覆蓋外部內容。使用者若要採用外部修改，系統必須以最新 approved revision 為 base 建立新的 Ticket Revision Draft，保存來源 snapshot 與差異，再走正常 approval；若不採用，則記錄 Decision，之後才可依受保護的 outbound sync 規則重新同步 canonical content。是否尚未處理由有無 resolution Decision 衍生。
_Avoid_: last-write-wins、直接修改 approved revision、從 stale base 建立 draft、忽略差異而不留決策

**Sync Conflict**:
外部工作項目狀態與內部權威語意不一致時建立的不可變偵測紀錄，例如內部 Ticket 已是 `done`，外部 work item 卻被重新開啟。Sync Conflict 必須保存 External Work Item、外部狀態、Ticket、內部 Delivery Status、偵測時間與來源事件；偵測本身不得自動降低內部狀態。使用者必須把原因分類為原 acceptance 無效、新增工作或外部誤操作，並分別執行 Result Revocation、建立 Follow-up Ticket，或維持內部 `done` 並重新執行 outbound close。解決選擇、Local Actor、時間與產生的 entity IDs 必須另以 Decision 與 audit event 保存；是否尚未解決由有無 resolution Decision 衍生。
_Avoid_: last-write-wins、自動 reopen 內部 Ticket、覆蓋其中一端而不留紀錄、用可變 conflict record 改寫偵測歷史

**Ticket Draft Batch**:
同一次 AI ticket generation 產生的一組 draft Tickets，用來保留共同的來源 graph 狀態與生成脈絡。Ticket Draft Batch 不是原子核准單位；使用者可以只核准其中符合目前交付範圍的 Tickets。每個 Ticket 核准時，必須確認其引用的產品意圖仍有效，且相依 Tickets 已核准或在同一次操作中一起核准。
_Avoid_: 自動核准生成的 Tickets、強制整批核准、核准具有未滿足相依關係的 Ticket

**Ticket Revision**:
Ticket 規格內容的不可變版本，具有 Review Status 與 Lifecycle Status，並記錄建立時的 `base_approved_revision_id`。核准時 base 必須仍等於 Ticket 的 current approved revision pointer，否則回傳 conflict；第一版可使用 `null` base。Title、目標、acceptance criteria、dependencies、產品意圖連結，或 required Implementation Target membership／per-revision scope 變更時，必須建立 draft Ticket Revision；核准後沿用原 Ticket identity 並成為目前 approved revision，舊的 approved revisions 保留供追溯。任何 replacement revision 核准時，都必須在同一 transaction 把 Ticket Delivery Status 重設為 `planned`，並以 `source_revision_superseded` archive 綁定舊 revision 的 active Implementation Briefs 與 Implementation Results；舊 artifacts 的 Review Status、Acceptances、evidence 與歷史關係不變，但不再支撐目前 handoff 或 completion。新版 Product Brief 核准後，只要 Ticket Revision 引用的產品意圖 nodes 仍是 active 且未變更、相依關係仍有效，就可沿用同一 revision；若來源 node 被更新、archived 或產生衝突，則必須建立新 Ticket Revision。
_Avoid_: 直接改寫 approved Ticket 規格、以新 Ticket identity 取代同一工作的修訂

**Implementation Target**:
Ticket + Repository 組合下的穩定 repository-specific delivery identity，具有 Lifecycle Status，不具有 Review Status。Ticket Revision 保存當版 required target membership 與 scope；新版仍需要同一 Repository 時必須沿用 active Target identity，即使沿用，Implementation Brief、Result 與 Acceptance 仍綁定新 Ticket Revision 並重新建立。同一 Ticket 最多只能有一個對應某 Repository 的 active Target。新版 approved revision 移除 Repository 時，必須 archive Target，並為其 active repository-specific External Work Item mappings 建立 close Sync Intents；日後重新加入該 Repository 時建立新 Target identity，不得直接復活 archived Target。每個 current required target 必須有獨立 Repository Context Snapshot、Implementation Brief 與 accepted Implementation Result；單一 brief 不得跨 Repositories。只有目前 approved revision 的所有 required Targets 都有 accepted result，Ticket 才可成為 `done`。
_Avoid_: revision-specific disposable identity、直接修改 target scope、復活 archived target、multi-repository brief、可選 target、只完成部分 repositories 就完成 Ticket

**Delivery Status**:
Ticket 相對於 current approved Ticket Revision 的執行進度，與規格的 Review Status（draft／approved）及 Lifecycle Status（active／archived）彼此獨立。Delivery Status 可以是 `planned`、`in_progress`、`blocked` 或 `done`，一般更新不需要重新核准 Ticket 規格；但任何 replacement Ticket Revision approval 都必須重設為 `planned`，不能沿用舊 revision 的 `in_progress`、`blocked` 或 `done`。`done` 必須由目前 revision 所有 required Implementation Targets 的有效 Result Acceptance 支撐；若其中一項 acceptance 被撤銷，當下為 `done` 的 Ticket 必須退回 `in_progress` 或 `blocked`，尚未完成的 Ticket 則保留原 Delivery Status。
_Avoid_: 把 approved 當成 done、用規格核准流程更新一般執行進度、跨 revision 沿用 delivery status、撤銷驗收後仍維持 done

**Implementation Brief**:
交給 coding agent 的不可變 handoff artifact。每個 Implementation Brief 擁有獨立 identity、Review Status 與 Lifecycle Status，不另設 aggregate；它綁定特定 approved Ticket Revision 的 Implementation Target、Product Brief Version 與該 target Repository 的 Repository Context Snapshot。AI 產生後先是 draft，經使用者明確核准後才可用於實作。同一 Implementation Target 最多只能有一份 active approved brief；同 revision 核准替代版本時，必須用 `supersedes_implementation_brief_id` 指向並 archive 舊版。Replacement Ticket Revision approval 會以 `source_revision_superseded` 自動 archive 舊 revision 的 active briefs；新 brief 可選擇以 supersedes link 指向最近的 archived predecessor，僅表示 lineage，不會重新啟用舊 brief。
_Avoid_: aggregate + version 雙層 identity、即時組合且無 identity 的 view、未核准便交付、悄悄更新既有 brief

**Repository Context Snapshot**:
生成 Implementation Brief 時實際使用的一組固定 repository context，可能包含 file list、module notes、repo summary 或由使用者與 client 提供的 code context。可供核准的 Snapshot 必須包含 repository identity 與 baseline commit SHA；若使用尚未提交的變更，還必須保存相關 diff 或內容雜湊。缺少可驗證 baseline 的 Snapshot 只能用來產生 draft Implementation Brief。Snapshot 描述當時可用的輸入，不保證代表 repository 的最新狀態。
_Avoid_: live repository state、未記錄來源的 code context、缺少 baseline 的 approved handoff、把 snapshot 當成持續同步資料

**Handoff Freshness**:
Implementation Brief 在交給 coding agent 當下，相對於目前相關產品意圖與 repository state 的衍生有效性。只有 Product Intent Reconciliation 為 `current`、brief 本身與所有來源皆 active、綁定的 Ticket Revision 仍是 current approved、該 revision 引用的產品意圖 nodes 自其 `source_graph_revision_id` 後仍 active 且未變更、dependencies 仍有效，以及目前 commit 與 dirty-state fingerprint 符合 Repository Context Snapshot 時，freshness 才是 `current`；任一條件不符或無法驗證時即為 `stale`。Brief 綁定的 Product Brief Version 是生成時的 provenance；current Product Brief pointer 改變不會直接讓所有 Tickets stale，但在 Graph reconciliation 完成前會暫時阻擋所有 handoff。完成 reconciliation 後，未受影響的 Ticket 可繼續使用原 brief；受影響 Ticket 必須建立 replacement revision 與新 brief。Replacement Ticket Revision 會 archive 舊 brief，因此它成為 archived approved、freshness stale 的歷史 artifact。Stale brief 不得執行 handoff，必須建立並核准新的 Implementation Brief。
_Avoid_: 只檢查 repository drift、只因 Product Brief pointer 改變就全面失效、忽略 referenced node changes、把 stale 當成 approval status、警告後強制執行、因來源改變而改寫舊 brief

**Implementation Result**:
Coding agent 完成一次實作嘗試後，由 client 提交的不可變候選結果與證據集合，具有 Review Status 與 Lifecycle Status。Implementation Result 必須綁定實際使用的 Implementation Brief，因此只適用於該 brief 的精確 Ticket Revision 與 Implementation Target，並記錄 resulting commits 或 pull request、測試結果及未完成事項。來源在提交時仍 current，Result 才以 active draft 建立並可進入 Result Acceptance；若 Product Intent Reconciliation 為 `pending`，或 Ticket Revision、Target、referenced intent nodes、dependencies 或其他相關 handoff source 已 stale，Observed Evidence 仍照常保存，但 Result 以 archived draft 建立，記錄 `stale_at_submission` 與理由，永遠不得接受、supersede active approved Result 或改變 Delivery Status。Product Brief current pointer 改變會在 reconciliation 完成前產生 `product_intent_unreconciled` stale reason；完成後則只由實際相關 graph changes 判斷。Client 提交 current result 時 Review Status 為 `draft`；Result Acceptance 是將它核准為 `approved` 的明確 Approval event，且每個 Result 最多只能建立一次 Acceptance。同一 Implementation Target 最多只能有一份 active approved Result；更正必須以 `supersedes_implementation_result_id` 指向舊 Result，並在 acceptance 時 archive 舊 Result 與其他 draft attempts。Replacement Ticket Revision approval 會以 `source_revision_superseded` archive 舊 revision 的 active draft 與 approved Results，但保留 Review Status、Acceptance 與 evidence；若 target 未變，可在新 brief 的新 Result 中重用既有 evidence，但必須重新產生 criterion verdict 並由使用者接受。提交 Implementation Result 不會自動把 Ticket 標為 `done`。
_Avoid_: agent completion claim、丟棄 late evidence、讓 stale result 維持 active draft、同一 Result 重複 acceptance、跨 Ticket Revision 沿用 acceptance、自動完成 Ticket、缺少 handoff 來源的結果

**Result Acceptance**:
使用者在系統驗證 Implementation Result 的來源關係後，明確接受該結果的 Approval event。每個 Implementation Result 最多只能建立一次 Result Acceptance；Acceptance 將 Result 的 Review Status 從 `draft` 變成 `approved`，並以自身的 `actor_id`、`accepted_at` 作為接受操作者與時間的唯一權威來源；Implementation Result 不重複保存 approval actor 或 time。`actor_id` 必須由 server 使用目前 Local Actor 設定，client 不得提供或覆寫。Server 必須在 acceptance transaction 開始時只從 transaction clock 擷取一次 event time，並將同一值寫入 `Result Acceptance.accepted_at`、所有 Result Acceptance Criterion Outcomes 的 `created_at`，以及本次建立的 Waiver Decisions 的 `created_at`。Acceptance 也記錄每項 criterion 的最終 Result Acceptance Criterion Outcome。Outcome 必須引用 coding agent 原始提交且不可變的 Acceptance Criterion Verdict；原 verdict、reason 與 evidence references 不得因 acceptance 或 waiver 被覆寫。若 outcome 是 `waived`，對應 Waiver Decision 也必須由同一 Local Actor 在 Result Acceptance 的同一 transaction 中提供理由、建立並綁定。Result Acceptance command 必須有 client-provided idempotency key；同一 Project、Local Actor、key 與相同 normalized command 的重試回放原始成功 response data，同 key 但 command 不同則 conflict。只有所有 required targets 都具有 approved Result 時，Result Acceptance 才能把對應 Ticket 的 Delivery Status 更新為 `done`；缺少可驗證結果時，Ticket 只能維持 `in_progress` 或 `blocked`。
_Avoid_: implicit acceptance、同一 Result 多次 acceptance、client-provided acceptance actor 或 time、沒有 idempotency key 的 acceptance retry、以 agent 回報取代使用者接受、無證據的 done、Result Acceptance 之外建立 Waiver Decision

**Operation Receipt**:
成功 mutating command 的持久化收據，用來把 client-provided idempotency key、Local Actor、normalized command fingerprint、原始成功 response data 與恰好一個 domain event 綁定在同一 Project 內。Phase 1A receipt 只能綁定 Result Acceptance 或 Result Revocation 其中一個，且 operation name 必須與該 event 類型一致；每個 Result Acceptance 或 Result Revocation 最多只能被一筆 receipt 引用。Operation Receipt 的 command fingerprint 必須先用 RFC 8785 JSON Canonicalization Scheme 產生 canonical bytes，再用 SHA-256 計算。Acceptance 與 Revocation command 不直接接受 Project identity；server 必須先由 command 的 target identity 只解析其存在性與 Project scope，不判定 lifecycle、current state 或其他 business validity，再執行 Operation Receipt lookup。若 target identity 不存在，command 必須立即回傳 `NOT_FOUND`，不得查找或建立 Operation Receipt。Operation Receipt lookup 必須先於完整 target state validation；相同 key、actor 與 command 命中 receipt 時必須直接 replay，即使目標已因原成功 transaction 而不再可執行，只有 receipt miss 才繼續完整驗證。Operation Receipt 只在 domain transaction 成功提交後建立，且只保存 successful `ToolResult.data` 的 RFC 8785 canonical JSON UTF-8 text，不保存完整 `ToolResult` envelope；replay 時由 server 重新包成標準成功 response。若原始成功 response 有 top-level `audit_log_id`，replay 必須回傳該原始 domain transaction 的 ID，不得以 replay observability log ID 取代。Validation error、`NOT_FOUND`、`CONFLICT`、`STALE_HANDOFF` 或其他失敗 response 不保存、不 replay。相同 key、actor 與 command 重試時只能回放原始成功 response data，且 replay 不得在 data 中新增 `replayed`、`receipt_id` 或其他 replay marker；replay observability 只能放在 audit log、server log 或非 domain envelope metadata。不同 idempotency key 一律代表不同 logical command，即使 normalized command 相同；若目標已因先前成功操作而不再可執行，必須回傳一般 conflict，不得反查既有 event 當作 replay。相同 key 但 command 內容不同代表 client bug，必須回傳 conflict。Operation Receipt 與它綁定的 Result Acceptance、Result Revocation，以及作為 replay target identity 的 Implementation Result，必須保留完整 replay 鏈，不得 hard delete；Implementation Result 可依 Lifecycle Status archive，其他三者沒有 lifecycle 軸且永久保留。Database delete guards 必須無條件保護 Receipt、Acceptance 與 Revocation，並在 Implementation Result 已進入 receipt replay 鏈時保護該 Result。
_Avoid_: transient cache、保存失敗 response、沒有綁定 domain event 的 receipt、同時綁定多個 domain events、多筆 receipts 指向同一 domain event、只靠 target row uniqueness 推測 retry 結果、不同 key 推測 replay、非 canonical command hash、在 response data 加 replay marker、用 domain data 表示 observability、同 key 不同 command 時靜默成功、刪除 receipt replay 鏈

**Result Revocation**:
使用者發現既有 Result Acceptance 在作成當時即無效，例如測試證據無效或 acceptance criterion 實際未滿足時，所執行的明確撤銷決策。任何仍有效、且其 Result 為 active approved 的 Result Acceptance 都可撤銷，不要求 Ticket 已是 `done`。Result Revocation 必須直接引用被撤銷的 Result Acceptance；Implementation Result 由該 Acceptance 關係衍生，不以 Result ID 取代事件關係。Revocation 與所引用 Decision 必須具有與 Result Acceptance 相同且非空的 Project identity，不能跨 Project 綁定。每個 Result Acceptance 最多只能建立一次 Revocation。Revocation 只保存 Decision node 與不可變的 `previous_delivery_status`、`resulting_delivery_status`；撤銷理由、Local Actor 與撤銷時間分別由該 Decision 的 `summary`、`actor_id` 與 `created_at` 提供，不在 Revocation 重複保存。Revocation command 必須有 client-provided idempotency key；同一 Project、Local Actor、key 與相同 normalized command 的重試回放原始成功 response data，同 key 但 command 不同則 conflict。若兩個 status 相同，表示撤銷未改變 Ticket 狀態。Revocation 永久 archive 對應的 active approved Implementation Result；若 Ticket 當下是 `done`，同一 transaction 必須將它退回 `in_progress` 或 `blocked`，若原本是 `planned`、`in_progress` 或 `blocked`，則保留原 Delivery Status。被撤銷的 Result 不得重新接受；後續修正必須提交新的 Implementation Result。原 Result、Result Acceptance、criterion outcomes、evidence 與 audit history 必須保留，不得刪除或改寫。
_Avoid_: silent rollback、只引用 Result 而未指明 Acceptance event、沒有 idempotency key 的 revocation retry、跨 Project Revocation／Decision、在 Revocation 複製 Decision reason／actor／time、刪除原驗收紀錄、重新接受被撤銷的 Result、因新需求或後續 regression 撤銷原驗收

**Follow-up Ticket**:
原 Ticket 完成後，針對新需求、後續 regression 或原 acceptance criteria 未涵蓋的問題所建立的新 Ticket。Follow-up Ticket 必須透過 `traces_to` 關係連回原 Ticket，並具有自己的 Ticket Revision、Implementation Targets 與 completion evidence；原 Ticket 維持 `done`。
_Avoid_: 為驗收範圍外的新工作 reopen 原 Ticket、直接擴寫已核准的 acceptance criteria、失去與原 Ticket 的追溯關係

**Acceptance Criterion Verdict**:
Implementation Result 對每一項 acceptance criterion 提供的不可變驗證結論；submission 時只能由 coding agent 提交 `satisfied` 或 `unsatisfied`。`satisfied` 必須說明所引用的 Observed Evidence 如何證明 criterion 已滿足，並至少引用一份屬於該 Implementation Result 完整 evidence set 的 Observed Evidence，才能參與 Result Acceptance。`unsatisfied` 必須說明未滿足的具體理由；它可不引用 evidence，也可引用 failed test 等反證，但除非使用者在 Result Acceptance 中建立 Waiver，否則會阻止 Result Acceptance。Result 可包含尚未被任何 Verdict 引用的 evidence，但它不支撐任何 criterion，也不影響 Result Acceptance。Result Acceptance 不得修改 Verdict 的 verdict、reason 或 evidence references，而是另建 Result Acceptance Criterion Outcome；Ticket 只有在所有 outcomes 都是 `satisfied` 或 `waived` 時才可完成。
_Avoid_: 無 reason 或無 evidence 的 satisfied verdict、無理由的 unsatisfied verdict、agent 提交 waived verdict、acceptance 覆寫 submission verdict、未驗證視為通過、只提供整體 pass／fail、忽略失敗 criterion、引用 Result evidence set 以外的 evidence、把未被 Verdict 引用的 evidence 當成 criterion 支撐

**Result Acceptance Criterion Outcome**:
Result Acceptance 對單一 acceptance criterion 記錄的最終處置，只能是 `satisfied` 或 `waived`，並必須引用該 Implementation Result 的原始 Acceptance Criterion Verdict。Outcome 的 Project identity 由 Result Acceptance 衍生，且必須與 submitted Verdict 所屬 Implementation Result 一致；其 `created_at` 必須等於所屬 Result Acceptance 的 `accepted_at`。`satisfied` outcome 只能引用 `satisfied` Verdict，且不需要 Waiver Decision；`waived` outcome 只能引用 `unsatisfied` Verdict，並必須綁定同一 Result Acceptance transaction 建立、具有相同且非空 Project identity、且 `created_at` 等於 Acceptance `accepted_at` 的 Waiver Decision。Acceptance response 中 Outcomes 必須依 approved Ticket Revision 的 `acceptance_criteria` 原始順序排列；Waiver Decisions 必須依其對應 Outcome 的位置排列。Outcome 不取代或修改原始 Verdict，而是保存使用者接受時的最終判定。
_Avoid_: 把 outcome 寫回 Verdict、跨 Project Outcome／Verdict／Decision、`satisfied` outcome 引用 `unsatisfied` Verdict、缺少 Waiver Decision 的 `waived` outcome

**Waiver**:
使用者附具體理由，明確接受某項 acceptance criterion 未被滿足的決策。Waiver 只能在 Result Acceptance 時由 Local Actor 建立，並在同一 transaction 建立引用對應 `unsatisfied` Verdict 的 `waived` Result Acceptance Criterion Outcome 且綁定 `decision_type = acceptance_criterion_waiver` 的 Decision；Implementation Result submission 不得提交 `waived`、接受或建立 `waiver_decision_id`。Waiver Decision 的 `project_id` 必須由 Result Acceptance 的非空 Project identity 衍生，並與 Outcome、Verdict 及 Implementation Result 屬於同一 Project；client 不得提供或覆寫 project scope 或 decision type。Input waiver reason 經 trim 後寫入 `Decision.summary`，waiver 的使用者與時間分別由 `Decision.actor_id`、`Decision.created_at` 提供，且 actor 必須與 Result Acceptance 相同；Outcome 不複製 reason、actor 或 waiver time。原 Verdict 的 `unsatisfied`、reason 與 evidence references 必須完整保留。Waiver 允許 criterion 參與 Ticket completion，但不把該 criterion 或原 Verdict 改寫成 `satisfied`。
_Avoid_: silent waiver、agent 自行豁免、錯誤 decision type、跨 Project Waiver Decision、覆寫原始 Verdict、在 Outcome 複製 Waiver reason／actor／time、把 waived 顯示為 passed、提交 Result 時預先建立 waiver

**Observed Evidence**:
在單人 MVP 中，由本機 MCP client 提供，且通過格式、repository identity 與引用完整性驗證的機器紀錄，例如 commit SHA、pull request identity 或 test execution result。Observed Evidence 必須綁定 Repository，但不直接綁定 Implementation Target；target binding 發生在 Implementation Result 引用 evidence 時。同一份 Observed Evidence 可被該 Repository 內多個 Implementation Results 引用，但每個 Result 必須各自建立 Evidence Interpretation 與 Acceptance Criterion Verdict，另一個 Result 的接受結論不會隨 evidence 重用而轉移。每個 payload 必須包含 `schema_version`；Phase 1A 只接受整數 `1`，且版本位於 payload 內並參與 canonicalization 與 hashing。Evidence ingestion 必須有 client-provided idempotency key；key 的唯一範圍是 Project，不是 Repository；server 先套用 schema-defined semantic normalization，再對 normalized payload 使用 RFC 8785 JSON Canonicalization Scheme 產生 canonical bytes，並計算 SHA-256 payload hash。`payload_json` 保存實際被 hash 的 canonical JSON UTF-8 文字，Phase 1A 不另外保存 client 原始 payload；同一 Project 內同一 key 重送時，只有 `repository_id`、`evidence_type` 與 server-computed `payload_hash` 都相同才回傳既有 Observed Evidence，不建立重複 canonical record；同 key 但任一欄位不同時回傳 conflict。Observed Evidence 可立即成為 canonical graph data，不需要內容 approval；它只表示系統保存了可追溯的 client 回報，不代表該事實已由獨立來源驗證、實作已被接受或 Ticket 已完成。MVP 不建立 Evidence Source 註冊或 assurance level；擴展至多人或外部 integrations 前必須重新決定來源信任模型。
_Avoid_: AI 推論、宣稱 independently verified、把 canonical evidence 當成 accepted result、把 evidence ingestion 綁定到單一 Implementation Target、把某 Result 的 verdict 或 acceptance 沿用到另一個 Result、retry 時建立重複 evidence、用 repository-scoped idempotency key、吞掉同 key 不同 payload 的 client bug、信任 client-provided payload hash、保存與 payload hash 不一致的原始 JSON

**Evidence Interpretation**:
AI 或其他推理流程對 Observed Evidence 產生的摘要、影響判讀或 Acceptance Criterion Verdict。Evidence Interpretation 一律先是 draft，必須經使用者接受後才能參與 Result Acceptance。
_Avoid_: 把 interpretation 當成 observed fact、自動接受 AI verdict

**Local Actor**:
單人 MVP 中代表使用者的穩定 identity，在首次使用時建立，並可設定或修改顯示名稱。所有 Approval、Waiver、Result Acceptance 與其他人工決策都歸屬於 Local Actor。Local Actor 不代表帳號、登入 session 或權限角色。
_Avoid_: 只保存顯示名稱、anonymous approver、把 Local Actor 當成 authentication model

**Archived Entity**:
已退出目前有效範圍、但仍保留完整追溯資料的歷史實體。Archived Entity 不參與新的 graph extraction、ticket generation 或 implementation handoff；既有 edges、versions 與 audit records 必須保留。曾經 canonical 或已被引用的實體不得 hard delete；若要重新啟用，必須透過新的 draft 或 change batch，而不能直接恢復為 approved。MVP 也不提供刪除 abandoned、unreferenced drafts 的一般 tool，這類 drafts 一律 archive；maintenance purge 與 retention policy 延後決定。
_Avoid_: soft pause、hard delete、直接 unarchive 為 approved、從歷史關係中移除、一般 workflow 中永久刪除 draft

**Stale Draft**:
其 base pointer 已不再等於 aggregate current approved pointer，或其 base Graph Revision 已不再 current 的 draft。成功 approval 必須在同一 transaction 自動 archive 因此變成 stale 的 sibling Product Brief Versions、Ticket Revisions 或 Graph Draft Batches，並在結果與 audit log 列出 IDs。Archived stale content 若仍有價值，必須以最新 base 建立新 draft。
_Avoid_: active but unapprovable draft、原地 rebase、刪除 stale draft

**Feedback Record**:
使用者提供的原始回饋內容，以不可變來源紀錄保存並可直接成為 canonical graph data。Feedback Record 本身不會直接修改 Product Brief、graph interpretation 或 Tickets；產品意圖的變更必須經過新的 Product Brief revision 與後續 Graph Draft Batch。
_Avoid_: AI 摘要、直接視為需求、因 feedback 自動修改產品意圖

**Feedback Interpretation**:
AI 對 Feedback Records 產生的摘要、主題分類、pain point 推論或產品建議。Feedback Interpretation 一律先是 draft，經使用者審查後才能作為 Product Brief revision 的輸入。
_Avoid_: raw feedback、未核准便成為 canonical product intent

**Idea Record**:
使用者原始提出的問題、機會或構想，以不可變來源紀錄保存並可直接成為 canonical graph data。Idea Record 是尚未驗證的起始輸入，不代表已核准要實作；只有 approved Product Brief 才能將其轉化為正式產品意圖。
_Avoid_: approved product decision、commitment、AI 改寫後的 idea

**Idea Interpretation**:
AI 對 Idea Record 進行的改寫、補充、澄清或假設。Idea Interpretation 一律先是 draft，只能作為 Product Brief draft 的輸入，不能取代原始 Idea Record。
_Avoid_: raw idea、canonical product intent、直接覆寫 Idea Record
