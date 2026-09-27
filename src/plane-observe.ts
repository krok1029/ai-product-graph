import { runPlaneObserve } from "./adapters/cli/plane-observe.js";

const result = await runPlaneObserve(process.argv.slice(2));
(result.exitCode === 0 ? process.stdout : process.stderr).write(result.output);
process.exitCode = result.exitCode;
