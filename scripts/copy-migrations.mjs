import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "src/infrastructure/migrations");
const destination = resolve(root, "dist/infrastructure/migrations");

mkdirSync(destination, { recursive: true });

for (const file of readdirSync(source)) {
  if (file.endsWith(".sql")) {
    copyFileSync(resolve(source, file), resolve(destination, file));
  }
}
