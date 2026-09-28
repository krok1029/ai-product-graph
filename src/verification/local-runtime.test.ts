import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { verifyLocalRuntime } from "./local-runtime.js";
import { fingerprint, observeSkills } from "./runtime-files.js";

const directories: string[] = [];
function temporary() {
  const directory = mkdtempSync(join(tmpdir(), "apg-verifier-test-"));
  directories.push(directory);
  return directory;
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

it("fingerprints content and relative paths, and refuses nested symlinks", () => {
  const first = temporary(); const second = temporary();
  for (const directory of [first, second]) {
    writeFileSync(join(directory, "b"), "two"); writeFileSync(join(directory, "a"), "one");
  }
  expect(fingerprint(first)).toEqual(fingerprint(second));
  writeFileSync(join(second, "a"), "changed");
  expect(fingerprint(first).sha256).not.toBe(fingerprint(second).sha256);
  symlinkSync(join(first, "a"), join(second, "linked"));
  expect(() => fingerprint(second)).toThrow("symlink");
});

it("observes the installed skill target, with missing or incomplete skills unknown", () => {
  const installed = temporary(); const target = temporary();
  writeFileSync(join(target, "SKILL.md"), "actual installed skill");
  symlinkSync(target, join(installed, "ai-product-plan"));
  mkdirSync(join(installed, "ai-product-implement"));
  const skills = observeSkills(installed);
  expect(skills[0]).toMatchObject({ status: "observed", resolvedPath: realpathSync(target), fingerprint: fingerprint(target) });
  expect(skills.slice(1).map(skill => skill.status)).toEqual(["unknown", "unknown"]);
});

it("keeps an error manifest and never opens an inherited user database", async () => {
  const parent = temporary(); const absent = join(parent, "missing-build");
  const protectedDatabase = join(parent, "user.sqlite");
  writeFileSync(protectedDatabase, "user data must remain intact");
  const previous = process.env.AI_PRODUCT_GRAPH_DB_PATH;
  process.env.AI_PRODUCT_GRAPH_DB_PATH = protectedDatabase;
  try {
    const result = await verifyLocalRuntime({ repositoryRoot: resolve("."), artifactsDirectory: absent,
      outputParent: parent, skillsDirectory: join(parent, "uninstalled") });
    expect(result.status).toBe("failed");
    expect(result.manifest.failure).toMatchObject({ stage: "snapshot" });
    expect(result.manifest.temporaryDatabasesRemoved).toBe(true);
    expect(JSON.parse(readFileSync(result.manifestPath, "utf8")).existingConnectorVersion).toBe("unknown");
    expect(readFileSync(protectedDatabase, "utf8")).toBe("user data must remain intact");
  } finally {
    if (previous === undefined) delete process.env.AI_PRODUCT_GRAPH_DB_PATH;
    else process.env.AI_PRODUCT_GRAPH_DB_PATH = previous;
  }
});

it("rejects an artifact root symlink instead of preserving a mutable source link as its snapshot", async () => {
  const parent = temporary(); const artifacts = join(parent, "build"); mkdirSync(artifacts);
  writeFileSync(join(artifacts, "index.js"), "throw new Error('must not execute')");
  const linked = join(parent, "linked-build"); symlinkSync(artifacts, linked);
  const result = await verifyLocalRuntime({ repositoryRoot: resolve("."), artifactsDirectory: linked,
    outputParent: parent, skillsDirectory: join(parent, "absent-skills") });
  expect(result.status).toBe("failed");
  expect(result.manifest.failure).toMatchObject({ stage: "snapshot", message: expect.stringContaining("directory symlink") });
  expect(result.manifest.temporaryDatabasesRemoved).toBe(true);
  expect(result.manifest.profiles).toBeUndefined();
  expect(existsSync(join(dirname(result.manifestPath), "artifacts"))).toBe(false);
});

// 以小型 MCP fixture 驗證程序管理；真實 SQLite 與建置產物另由 verify:runtime 驗證。
function fixtureSource(valid: boolean) {
  return `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const path = process.env.AI_PRODUCT_GRAPH_DB_PATH;
writeFileSync(path + '.pid', String(process.pid));
const server = new McpServer({name:'test-fixture',version:'1'});
const result = data => ({content:[], structuredContent:{data}});
const project = {id:'persisted-project',name:'fixture'};
server.registerTool('list_projects', {}, async () => result({projects:existsSync(path) ? [JSON.parse(readFileSync(path))] : []}));
server.registerTool('create_project', {}, async () => {writeFileSync(path,JSON.stringify(project));return result({project});});
${valid ? "server.registerTool('get_project', {}, async () => result({project:JSON.parse(readFileSync(path))}));" : ""}
if (process.env.AI_PRODUCT_GRAPH_MCP_PROFILE === 'full') {
  server.registerTool('create_graph_draft_batch', {}, async () => result({}));
  server.registerPrompt('fixture', {}, async () => ({messages:[]}));
}
await server.connect(new StdioServerTransport());`;
}

it("runs both isolated profiles, verifies restart persistence, and retains the snapshot and manifest", async () => {
  const parent = temporary(); const artifacts = join(parent, "build"); mkdirSync(artifacts);
  writeFileSync(join(artifacts, "index.js"), fixtureSource(true));
  const result = await verifyLocalRuntime({ repositoryRoot: resolve("."), artifactsDirectory: artifacts,
    outputParent: parent, skillsDirectory: join(parent, "absent-skills") });
  expect(result.status, JSON.stringify(result.manifest.failure)).toBe("passed");
  const profiles = result.manifest.profiles as { profile: string; databasePath: string; restart: { status: string }; sessions: { closed: boolean; pid: number }[] }[];
  expect(profiles.map(profile => profile.profile)).toEqual(["core", "full"]);
  for (const profile of profiles) {
    expect(profile.restart.status).toBe("passed");
    expect(existsSync(profile.databasePath)).toBe(false);
    expect(profile.sessions).toHaveLength(2);
    for (const session of profile.sessions) {
      expect(session.closed).toBe(true);
      expect(() => process.kill(session.pid, 0)).toThrow();
    }
  }
  expect(result.manifest.artifacts).toMatchObject({ unchangedAfterExecution: true });
  expect(readdirSync(dirname(result.manifestPath))).not.toContain(expect.stringMatching(/^databases-/));
}, 20_000);

it("fails at discovery, closes its child, and cleans its temporary database directory", async () => {
  const parent = temporary(); const artifacts = join(parent, "build"); mkdirSync(artifacts);
  const pidFile = join(parent, "pid");
  writeFileSync(join(artifacts, "index.js"), fixtureSource(false).replace("path + '.pid'", JSON.stringify(pidFile)));
  const result = await verifyLocalRuntime({ repositoryRoot: resolve("."), artifactsDirectory: artifacts,
    outputParent: parent, skillsDirectory: join(parent, "absent-skills") });
  expect(result.status).toBe("failed");
  expect(result.manifest.failure).toMatchObject({ stage: "core-discovery-and-restart" });
  expect(result.manifest.temporaryDatabasesRemoved).toBe(true);
  expect(() => process.kill(Number(readFileSync(pidFile, "utf8")), 0)).toThrow();
}, 20_000);
