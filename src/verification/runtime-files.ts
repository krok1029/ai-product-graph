import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

export const skillNames = ["ai-product-plan", "ai-product-implement", "ai-product-accept"];
export const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

// 雜湊包含排序後的相對路徑與檔案內容；不把雜湊當成來源認證。
export function fingerprint(directory: string) {
  const files: { path: string; sha256: string }[] = [];
  function visit(relative: string) {
    for (const name of readdirSync(join(directory, relative)).sort()) {
      const path = relative ? `${relative}/${name}` : name;
      const info = lstatSync(join(directory, path));
      if (info.isSymbolicLink()) throw new Error(`Nested symlink is not supported: ${path}`);
      if (info.isDirectory()) visit(path);
      else if (info.isFile()) files.push({ path, sha256: hash(readFileSync(join(directory, path))) });
      else throw new Error(`Unsupported file: ${path}`);
    }
  }
  visit("");
  return { algorithm: "sha256-sorted-path-content-v1", sha256: hash(JSON.stringify(files)), files };
}

export function observeSkills(directory: string) {
  return skillNames.map(name => {
    const configuredPath = join(directory, name);
    try {
      const resolvedPath = realpathSync(configuredPath);
      // 沒有入口檔的資料夾不能宣稱是已安裝 skill。
      readFileSync(join(resolvedPath, "SKILL.md"));
      return { name, configuredPath, resolvedPath, status: "observed", fingerprint: fingerprint(resolvedPath) };
    } catch (error) {
      return { name, configuredPath, status: "unknown", reason: String(error) };
    }
  });
}

export function observeSource(directory: string) {
  try {
    const run = (...args: string[]) => execFileSync("git", ["-C", directory, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    return { status: "observed", directory, commit: run("rev-parse", "HEAD"),
      dirty: run("status", "--porcelain").length > 0, artifactBuildProvenance: "unknown" };
  } catch (error) {
    return { status: "unknown", directory, artifactBuildProvenance: "unknown", reason: String(error) };
  }
}
