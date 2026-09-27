// 審查文件共用的文字與建議檔名格式。
export function safeFilenamePart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-") || "artifact";
}

export function markdownText(value: string) {
  // 來源文字可含 Markdown 或 HTML；當作文字呈現，避免改變文件結構。
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/([\\`*_{}\[\]()#+.!|~-])/g, "\\$1")
    .replace(/\r?\n/g, "<br>");
}

export function list(values: readonly string[]) {
  return values.length ? values.map(value => `- ${markdownText(value)}`) : ["- None"];
}
