import { runPlaneExport } from "./adapters/cli/plane-export.js";

const result = await runPlaneExport(process.argv.slice(2));
(result.exitCode === 0 ? process.stdout : process.stderr).write(result.output);
process.exitCode = result.exitCode;
