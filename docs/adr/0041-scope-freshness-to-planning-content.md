# ADR 0041：以規劃內容版本縮小失效範圍

2026-09-28，雙人踩地雷試用顯示：擴充戰績後，單純重新確認原單局 Spec 也會推進來源版本，迫使未變更功能重建 Ticket、Brief、Result 並重新接受。決定細化 ADR0019／0040 的來源失效規則，將 Milestone／Spec 的內容版本與每次保存的 Graph Revision 分開。內容版本以標題、描述、結構化內容及父歸屬判定；只更新父來源確認時保留原版本。相同內容以 canonical JSON 比較，不讓模型猜測不同文字是否語意相等。

完整 Spec → Milestone → Brief 鏈仍須先從上游重新比對，未確認時阻擋 handoff 與新 Acceptance。來源鏈有效後，Ticket 的 freshness 比較來源 Spec 的內容版本及額外引用節點，並沿用 dependency 檢查；祖先的來源確認不再單獨使 Ticket 失效。真正內容變更、移動、封存仍須修訂受影響工作。此取捨信任 agent 對「相同規格仍適用」的明確保存，避免把所有上游保存都當成下游內容變更；server 保證結構與版本，不能保證產品判斷正確。

Graph Revision、immutable batch payload、舊 Ticket Revision、evidence、Acceptance 保留原義與歷史，不自動撤銷完成紀錄、不恢復已被替代的 artifacts。舊節點缺少內容版本時保守採最後 Graph Revision，不猜測更早歷史。圖譜影響清單、交付查詢與執行共用來源 freshness；交付查詢另列 blockers、證據缺口、待接受結果及下一步，無資料寫入。Repository baseline 與 optimistic concurrency 的保護不變。

同時細化 ADR0039 的對話流程：使用者明確授權實作已核准 Ticket 後，同範圍的具體技術計畫由既有授權涵蓋，保存後可直接 start；實質範圍、target、風險變化才補足所需同意。server 仍保存精確 Brief 的 approval 並原子驗證 handoff，不將授權延伸成新規格核准或 Result Acceptance。
