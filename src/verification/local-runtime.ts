import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fingerprint, hash, observeSkills, observeSource } from "./runtime-files.js";
import { probeProfile } from "./runtime-probe.js";

export type VerificationOptions = {
  repositoryRoot: string;
  artifactsDirectory?: string;
  skillsDirectory?: string;
  outputParent?: string;
};

export async function verifyLocalRuntime(options: VerificationOptions) {
  const repositoryRoot = resolve(options.repositoryRoot);
  const artifactsDirectory = resolve(options.artifactsDirectory ?? join(repositoryRoot, "dist"));
  const skillsDirectory = resolve(options.skillsDirectory ?? join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "skills"));
  const outputDirectory = mkdtempSync(join(resolve(options.outputParent ?? tmpdir()), "apg-runtime-proof-"));
  const snapshotDirectory = join(outputDirectory, "artifacts");
  const databaseDirectory = mkdtempSync(join(outputDirectory, "databases-"));
  const manifestPath = join(outputDirectory, "manifest.json");
  const manifest: Record<string, unknown> = {
    schemaVersion: 1, status: "running", startedAt: new Date().toISOString(),
    scope: "isolated-stdio-fixture", existingConnectorVersion: "unknown",
    node: { executable: process.execPath, version: process.version, platform: process.platform, architecture: process.arch },
    sourceObservation: observeSource(repositoryRoot),
    installedSkills: observeSkills(skillsDirectory),
    limitations: ["Source checkout observation does not prove artifact build provenance.",
      "Installed skill hashes describe disk bytes, not skills loaded by any agent.",
      "Dependencies are shared from node_modules; dependency bytes are not snapshotted or attested.",
      "Hashes are local observations, not remote authentication.",
      "Only isolated discovery and fixture persistence are verified; no existing connector is restarted or identified."]
  };
  let stage = "snapshot";
  try {
    const before = fingerprint(artifactsDirectory);
    if (!existsSync(join(artifactsDirectory, "index.js"))) throw new Error("Build artifacts must include index.js; run the build first.");
    cpSync(artifactsDirectory, snapshotDirectory, { recursive: true, errorOnExist: true });
    const copied = fingerprint(snapshotDirectory);
    if (before.sha256 !== copied.sha256 || fingerprint(artifactsDirectory).sha256 !== before.sha256) {
      throw new Error("Artifacts changed while copying; rebuild and retry.");
    }
    writeFileSync(join(outputDirectory, "package.json"), JSON.stringify({ private: true, type: "module" }));
    const dependencyDirectory = realpathSync(join(repositoryRoot, "node_modules"));
    symlinkSync(dependencyDirectory, join(outputDirectory, "node_modules"), "dir");
    const lockfile = join(repositoryRoot, "pnpm-lock.yaml");
    manifest.dependencies = { directory: dependencyDirectory, snapshotStatus: "not-snapshotted",
      lockfileSha256: existsSync(lockfile) ? hash(readFileSync(lockfile)) : "unknown" };
    manifest.artifacts = { sourceDirectory: artifactsDirectory, snapshotDirectory,
      entrypoint: join(snapshotDirectory, "index.js"), fingerprint: copied, unchangedAfterExecution: false };
    const profiles: Awaited<ReturnType<typeof probeProfile>>[] = [];
    manifest.profiles = profiles;
    for (const profile of ["core", "full"] as const) {
      stage = `${profile}-discovery-and-restart`;
      profiles.push(await probeProfile(join(snapshotDirectory, "index.js"), join(databaseDirectory, `${profile}.sqlite`), profile));
    }
    stage = "snapshot-integrity";
    if (fingerprint(snapshotDirectory).sha256 !== copied.sha256) throw new Error("Snapshot bytes changed during verification.");
    (manifest.artifacts as Record<string, unknown>).unchangedAfterExecution = true;
    manifest.status = "passed";
  } catch (error) {
    manifest.status = "failed";
    manifest.failure = { stage, message: String(error) };
  } finally {
    // 只刪除此執行自行建立的暫存 DB；產物複本與 manifest 留給後續審查。
    try { rmSync(databaseDirectory, { recursive: true, force: true }); manifest.temporaryDatabasesRemoved = true; }
    catch (error) { manifest.status = "failed"; manifest.cleanupFailure = String(error); }
    manifest.completedAt = new Date().toISOString();
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return { status: manifest.status, manifestPath, manifest };
}
