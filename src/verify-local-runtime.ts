import { parseArgs } from "node:util";
import { verifyLocalRuntime } from "./verification/local-runtime.js";

try {
  const { values } = parseArgs({ options: {
    "repository-root": { type: "string", default: process.cwd() },
    "artifacts-directory": { type: "string" },
    "skills-directory": { type: "string" },
    "output-parent": { type: "string" }
  } });
  const result = await verifyLocalRuntime({ repositoryRoot: values["repository-root"],
    artifactsDirectory: values["artifacts-directory"], skillsDirectory: values["skills-directory"],
    outputParent: values["output-parent"] });
  console.log(JSON.stringify({ status: result.status, manifestPath: result.manifestPath }));
  if (result.status !== "passed") process.exitCode = 1;
} catch (error) {
  console.error(`Runtime verification could not start: ${String(error)}`);
  process.exitCode = 1;
}
