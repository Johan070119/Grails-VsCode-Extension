import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyVsix } from "./verify-vsix.mjs";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
const artifacts = path.join(repositoryRoot, "artifacts");
const output = path.join(artifacts, `${manifest.name}-${manifest.version}.vsix`);
fs.mkdirSync(artifacts, { recursive: true });

const vsce = path.join(repositoryRoot, "node_modules", "@vscode", "vsce", "vsce");
const result = spawnSync(process.execPath, [vsce, "package", "--out", output], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: "inherit",
});
if (result.status !== 0) throw new Error(`vsce package failed with exit code ${result.status ?? "unknown"}`);
const verification = verifyVsix(output);
console.log(`Release candidate: ${output} (${verification.files} packaged files).`);
