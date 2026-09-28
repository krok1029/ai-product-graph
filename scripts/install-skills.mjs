// 將本 repository 的三個 skills 連到本機 Codex；保留既有同名安裝，不覆寫。
import { lstatSync, mkdirSync, readlinkSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "skills");
const names = ["ai-product-plan", "ai-product-implement", "ai-product-accept"];
// 先驗證全部目標，避免遇到同名 skill 時只安裝一半。
for (const name of names) {
  const target = join(destination, name);
  try {
    const info = lstatSync(target);
    if (!info.isSymbolicLink() || resolve(destination, readlinkSync(target)) !== join(root, "skills", name)) {
      throw new Error(`Existing skill is not owned by this repository: ${target}`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
mkdirSync(destination, { recursive: true });
for (const name of names) {
  const target = join(destination, name);
  try { lstatSync(target); } catch (error) {
    if (error.code !== "ENOENT") throw error;
    symlinkSync(join(root, "skills", name), target, "dir");
  }
  console.log(target);
}
