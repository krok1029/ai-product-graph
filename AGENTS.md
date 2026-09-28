## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five canonical Matt Pocock skill labels. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository. See `docs/agents/domain.md`.

### Code organization

- 新建專案的原始碼一律放在 `/Users/limingfeng/Project/<project-name>`；登記 Repository 時，`root_path` 必須填入該專案的實際絕對路徑。
- 程式碼註解請使用中文，除非是引用外部 API 名稱、錯誤碼、協定欄位或既有英文 domain term。
- 正式程式碼單一檔案盡量控制在 500 行以內；最多不要超過 800 行。
- 如果新增功能會讓檔案接近 800 行，先拆出清楚的 module/helper/adapter，再繼續實作。
- 測試檔可在必要時超過 800 行，但如果因為 production 拆檔造成測試失敗，必須一起修復測試。
