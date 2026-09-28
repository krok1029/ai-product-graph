# 本機 runtime 驗證

對應 Spec #116、Ticket #119。這個明確執行的工具會複製指定的建置產物，啟動自己管理的 core／full stdio server，驗證 discovery 與重啟後讀取同一個 fixture Project。它不辨識、不重新啟動既有 Codex connector，也不操作使用者資料庫。

## 執行

需要 Node.js 20 以上、已安裝且可用的 repository dependencies。工具不安裝 dependencies，也不呼叫 Plane 或其他 provider。

```sh
npm run build
npm run verify:runtime
```

輸出一行 JSON，包含 `status` 與絕對 `manifestPath`。成功退出碼為 0，失敗為 1。可指定：

```sh
npm run verify:runtime -- --artifacts-directory /absolute/build/dist --skills-directory /absolute/codex/skills --output-parent /absolute/existing/output
```

`--repository-root` 預設為目前目錄，用於觀察 Git 與尋找既有 `node_modules`；`--artifacts-directory` 預設是 repository 下的 `dist`。`--skills-directory` 預設是 `$CODEX_HOME/skills`，沒有 CODEX_HOME 時使用 `~/.codex/skills`。`--output-parent` 必須已存在，預設為系統暫存目錄。每次都建立唯一子目錄，不覆寫舊報告。

## Manifest 的證明範圍

- `sourceObservation` 是執行當時工作目錄的 commit 與 dirty 狀態；即使 Git 可讀，`artifactBuildProvenance` 仍為 `unknown`，不以目前原始碼冒充建置來源。
- `artifacts` 保存實際啟動複本的入口、每個相對檔案路徑及 SHA-256，以及排序後檔案清單 JSON 的 SHA-256。複製前後及執行後比對內容；來源在複製時變動或複本在執行時變動，都會失敗。
- `dependencies` 只記錄共用 dependency 目錄與 repository lockfile hash。依賴沒有複製或完整驗證，不能把結果宣稱為完整 hermetic build 或 dependency attestation。
- `installedSkills` 讀取三個實際安裝位置，可解析入口目錄 symlink，保存 real path 與整個 skill 目錄檔案指紋。缺少入口、無法讀取或含巢狀 symlink 時記為 `unknown`；不改用 repository skill 冒充已安裝版本，也不推論 agent 記憶體中的版本。
- `profiles` 保存每個 profile 的工具／prompts 名稱與 server 自報版本。Core 必須沒有 full graph draft tool 或 prompt capability，full 必須提供兩者。名稱完整列出，不把自報 `0.1.0` 當成產物版本證明。
- 每個 profile 有獨立的新暫存 SQLite。首次連線先確認沒有 Project，建立一個 fixture，再關閉程序。重啟只呼叫 `get_project`／`list_projects`，比對持久化內容與 discovery。這裡的唯讀指「重啟後的 MCP tool 操作」；server 啟動仍可能執行 migration。
- `existingConnectorVersion` 永遠為 `unknown`。SHA-256 是本機內容識別，不代表遠端認證或使用者驗收。

正常成功或錯誤路徑皆關閉自己啟動的 client／server，刪除自己建立的暫存 DB，保留 manifest、產物複本及 module resolution 所需的 package.json／dependency symlink。執行錯誤會記錄 `failure.stage`；連線／tool 請求 timeout 為 10 秒，並保存有上限的 server stderr。無法建立輸出目錄或寫入 manifest 的錯誤直接寫入 stderr。程序被作業系統強制殺死或斷電不保證清理，可手動刪除輸出的整個 `apg-runtime-proof-*` 目錄。

## 驗證與限制

`src/verification/local-runtime.test.ts` 以 Vitest 驗證內容指紋、實際 skill symlink、unknown、錯誤報告、child 關閉、DB 清理與 MCP 重啟編排。小型 MCP fixture 僅測試編排；`npm run verify:runtime` 才是實際 built server／SQLite 驗證。

這次先選擇最小 fixture，不重跑 A／B／C 全部產品情境。它讓後續報告能精確指出「驗證了哪些本機 bytes」，不能追溯先前 connector 載入版本，也不能單獨支撐 skills 自然語言品質、效能或產品 Acceptance。若需要版本成本比較，必須以各版本重新建置並重新執行相同情境。
