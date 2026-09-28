# 本機流程工程收尾：集中審查包

對應 Spec #118／Ticket #123，承接 #106 正確性與管理成本報告。功能與證據 PR #124–#127 已合併；整合基線的全部 1,002 項測試通過。這份審查包完成工程收尾，正式產品 Acceptance 留待使用者最後審查。

## 交付邊界

本輪只處理本機、單人工作流。使用者授權自主拆規格、並行實作、獨立 PR review 與合併，最後集中審查。Plane 後續同步與本機 UI 不在本輪；雲端多人及 GitHub adapter 已移出必做範圍，GitHub 採 `gh`＋既有 evidence 流程。

「工程收尾」表示功能、適用驗證與審查材料齊備，不表示 agent 替使用者接受了產品。正式清單 r3 Result 待接受，篩選 r2 的依賴與後續正式交付須由最後審查後的正常流程完成；隔離回放不取代 live Acceptance。

## 正確性矩陣

判定以實際證據為準：通過、部分通過、未觸發、待最終審查不同。以下 A/B/C 指 #98 的原始真實使用情境，新工程回放另列，不回填歷史。

| 條件 | 歷史／正式資料判定 | 證據與限制 |
| --- | --- | --- |
| A1 新能力上游變更如實顯示過期來源 | 通過 | v2 後原工作 source stale，見 [情境 A](2026-09-28-workflow-filter.md) |
| A2 不變內容確認新父來源 | 通過 | M1 同內容保存即可恢復；未重建 Specs |
| A3 保留原交付 identities | 通過（已比對範圍） | 原兩組 Ticket/Target/Brief/Result IDs 保留，不延伸為完整歷史重複數為零 |
| A4 新能力自己的交付與接受 | 通過 | 篩選有獨立 Spec/Ticket/Result/Acceptance；當時三張 done/current |
| B1 真實內容版本前進與影響 | 通過 | [排序影響](2026-09-28-workflow-sorting-impact.md) 與 [replacement 檢查點](2026-09-28-workflow-sorting-handoff.md)；各時點分開 |
| B2 拒絕舊 handoff／真正 pending Acceptance | 通過（保存回應範圍） | 來源往返後 `STALE_HANDOFF`／`graph_node_changed`；拒絕前後 context 相等，無關說明保持有效 |
| B3 最新來源 replacement 與實作 | 部分通過 | 清單 r3 已合法 start 並提交 Result；篩選 r2 current，但 live 仍依賴清單接受 |
| B4 新結果接受、保留歷史、內容回復不復活舊 handoff | 部分通過／待最終審查 | 防護已驗證；新清單與篩選的正式接受未完成，不能以隔離回放改成全通過 |
| C1 新對話辨識關係與下一步 | 通過（回報及交叉查詢範圍） | [唯讀接手](2026-09-28-workflow-fresh-handoff.md)，PR #115；新任務未保存所有原始 response payload |
| C2 沿用已有工作，不重建 | 通過（唯讀接手） | 前後 graph/work-context 相同；沒有新寫入，尚非新任務實際接受 |
| C3 不要求重述、缺授權不擅自開工 | 通過（該 turn） | 新任務守唯讀邊界；補授權後開工分支未觸發 |
| C4 開工時核對真實 baseline | 歷史情境未觸發 | #104 是唯讀任務；#121 的隔離工程檢查另列，不能追認 C4 歷史已實測 |
| C5 區分 Ticket 交付與 Milestone 退出條件 | 通過 | 唯讀接手明示歷史 done 不等於新 Milestone 完成 |

## 管理成本：已知與未知

| 項目 | 可報資料 | 不可推論 |
| --- | --- | --- |
| A 已知決策 | v2 範圍、篩選 Ticket、篩選 Result 三項決策；初版接受另列前置 | 不是完整問答／確認總數 |
| B 已知決策 | v3/拆票及接手授權、r2、r3與篩選r2共同核准等可定位項目 | 同一回覆涵蓋多版本不能當多次人工回合 |
| A 事件區間 | v2 draft 至篩選 Acceptance：1,099.055 秒 | 不是情境總耗時或有效工作時間 |
| B 局部區間 | r2 draft 至 Result：833.554 秒；另有來源往返、測試及桌面觀察時間 | 不將部分或重疊區間相加成完整成本 |
| C task turn | 168,248 ms | 不是 C 的總耗時、工作或等待時間 |
| 全程總耗時／有效工作／等待 | 未量測，保留 unknown | 不由工具呼叫數、token 或 server event 推估 |
| 重複確認／使用者人工糾正／全歷史重複 artifacts | 未完整量測 | 未發現不等於零；必要 replacement 不等於重複 artifacts |
| 成本改善比例 | 沒有等價對照 run | 不宣稱省時或零管理負擔 |

成本來源為各情境已提交的 Markdown/JSON 與保存的操作紀錄。舊 MCP loaded version 與情境當時 skills hashes 不完整；新的 runtime 驗證只改善新 run 的可定位性，不補造舊來源。原始檔的本機保存位置與 hashes 見各情境記錄；公開投影不能重建所有原始回應。

## 工程成果與整合檢查

四份工程 PR 已合併到同一主分支 `eab9fa07cc94fd479f8fe95b4a261b19fe964c29`。2026-09-28 15:43–15:44（Asia/Taipei）在此版本執行整合檢查；後續審查包只修改文件與證據，不將文件提交冒充測試來源。來源、時間、已安裝 skills hashes、工具清單與原始檔 hashes 見 [整合證據 JSON](2026-09-28-local-closeout-integration.json)。

| Ticket／PR | 交付 | Reviewed head／主分支 squash commit |
| --- | --- | --- |
| #122／[PR #124](https://github.com/krok1029/ai-product-graph/pull/124) | 本機單人範圍與決策 | `083058d52c6460c97472578151a2d6a0681be7e1`／`ed1b22c854b4437441032ee4ec0baded990a33d1` |
| #121／[PR #127](https://github.com/krok1029/ai-product-graph/pull/127) | 歷史來源核對、七條準則工程映射、隔離協定回放 | `4c24457d79e6245bcc09f0d2bba61a993cd92814`／`c95dcde1d48fef483b8d5c565954320329fee303` |
| #119／[PR #126](https://github.com/krok1029/ai-product-graph/pull/126) | 明確執行的 [runtime 驗證入口](../local-runtime-verification.md) | `ccb1c590b6bc3d53356e817ee01d385219e202c5`／`10c18f5d9fa526d76cee9ea844d41ba4082d4ea9` |
| #120／[PR #125](https://github.com/krok1029/ai-product-graph/pull/125) | [Milestone／Spec 唯讀交付摘要](../stage-progress.md) | `8348a14e53d7bdaae0d014eb87e4459a1409fd0c`／`eab9fa07cc94fd479f8fe95b4a261b19fe964c29` |

整合檢查：64 個測試檔、1,002 tests 全通過；包含 24 項 planning 行為測試及 6 項 runtime 驗證測試。TypeScript 7／6、build、smoke 皆成功。新的階段摘要維持全專案範圍，保留 done／stale 重疊、pending／blocked、空階段及未歸組原因；不推論階段完成。

Built runtime 新 run 在 `07:44:09.706–07:44:10.575 UTC` 成功：core 23 tools／0 prompts，full 46 tools／6 prompts；各自建立全新暫存 SQLite、關閉再啟動並讀回同一 Project，結束清理 DB。503 份建置檔案已保存指紋及實體複本，三個實際 installed skills 皆取得指紋。Dependencies 共用而非完整快照；來源 checkout 的 `dirty=true` 來自未追蹤審查稿與 dependency symlink，當時 tracked source diff 為空。Manifest 的 build provenance 與既有 connector version 仍為 `unknown`，不把人工操作紀錄提升為來源認證。

同一整合 commit 的隔離回放再次通過依賴解除、錯誤 baseline 拒絕、正確 handoff、pending 與 accepted 區分、接受冪等與 SQLite integrity。[正式 MCP 唯讀覆核](2026-09-28-local-closeout-live.json)仍為三張 Ticket：1 done、1 awaiting acceptance、1 blocked、0 stale；沒有執行 live Acceptance。[工程報告](2026-09-28-local-closeout-engineering.md) 保存逐準則限制；新回放不能改寫 C4 歷史未觸發。

一次本機指令把 `pnpm` 的多餘 `--` 傳入 CLI，於啟動前遭參數檢查拒絕；改用文件對應的 built Node 入口後成功。失敗與成功 log 分別保留。這是本輪已知操作修正，不是使用者修正，也不代表全歷史操作錯誤總數。

## 獨立 PR 審查與修正循環

新開 `review_spec_batch` agent 做 Spec 軸；Standards 軸由未撰寫該 PR 的獨立 agent 做。系統達到 agent thread 上限後，沿用已完成其他工作的 reviewer context，不让任何人審自己的變更；兩軸報告分開保留於 PR 說明。這個限制及安排沒有略過 review。

| PR | Spec 軸 | Standards 軸 | 修正後結果 |
| --- | --- | --- | --- |
| #124 | review_spec_batch：無 findings | progress_impl：無 findings | 兩軸 clean |
| #127 | review_spec_batch：無 findings、独立回放通過 | progress_impl：無 findings | 兩軸 clean |
| #126 | review_spec_batch：初審與重審 clean、重跑 6/6 | progress_impl 初審 P2；audit_closeout 重審 clean | 根 artifact symlink 原會留下可變來源 link；改為拒絕並補測試 |
| #125 | review_spec_batch：初審 P2、重審 clean、重跑 24/24 | audit_closeout：相同 P2、重審 clean | 額外引用誤當父關係；改核對父 edge 歷史版本，無法證明時明列未歸組 |

兩個獨立問題均已修正，無未解決功能 findings。最後審查包本身的固定 head 與兩軸結果以關閉 #123 的 PR 記錄為準；文件內不自造其尚未存在的 commit hash。

## 自主決策與剩餘事情

完整取捨、理由、不確定性與調整方式在 [決策紀錄](2026-09-28-closeout-decisions.md)。Spec #116／#117／#118 及五張工程 Ticket 的交付範圍已齊備；關閉工程追蹤不等於替使用者接受 live Result。#104 已完成；#105 保留正式驗收缺口；#106 的報告內容已交付，待最後審查，#98 的原始完整退出條件仍未宣稱全數達成。

當前沒有本輪未實作的獨立工程票。剩下最後產品審查與正式清單／篩選接受鏈；歷史完整成本無法追補，若要量化改善須另安排等價 run。Plane 後續同步與本機 Web UI 是範圍外選項，不算成本輪必做欠項。

## 最後審查清單

1. 審閱本機單人範圍與 `gh` 分工是否符合預期。
2. 審閱自主決策、不確定性與調整方式；重點為 runtime 證明範圍、階段分組語意及隔離驗證限制。
3. 審閱清單 r3 pending Result；若接受，解除篩選依賴後再用正常 handoff/Result/Acceptance 完成正式下游交付。若拒絕，保存具體修訂與新結果。
4. 逐條決定 #105/#98 與 Milestone 的產品驗收；工程 PR 合併不能替代該決定。#106 的報告可以完整揭露未達條件，而不宣稱原驗證全部成功。
5. 若要量化省時，安排有完整請求時間、等待區間與必要決策紀錄的等價 run；此項不以虛構數據補成本輪已達成。

完成審查前不恢復 Plane 後續同步、Web UI 或其他擴充。
