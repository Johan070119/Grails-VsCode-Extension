import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const metadata = JSON.parse(
    readFileSync(join(repositoryRoot, "semantic-server", "upstream.json"), "utf8"),
);
const temporaryRoot = mkdtempSync(join(tmpdir(), "grails-semantic-build-"));
const checkout = join(temporaryRoot, "groovy-language-server-spike");

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: options.cwd ?? repositoryRoot,
        stdio: "inherit",
        shell: options.shell ?? false,
        env: options.env ?? process.env,
    });
    if (result.status !== 0) {
        throw new Error(`${command} failed with exit code ${result.status ?? "unknown"}`);
    }
}

try {
    run("git", ["clone", "--filter=blob:none", "--no-checkout", metadata.repository, checkout]);
    run("git", ["checkout", "--detach", metadata.commit], { cwd: checkout });

    const windows = process.platform === "win32";
    run(windows ? "gradlew.bat" : "./gradlew", ["shadowJar", "--no-daemon"], {
        cwd: checkout,
        shell: windows,
        env: {
            ...process.env,
            JAVA_HOME:
                process.env.GRAILS_SEMANTIC_JAVA_HOME || process.env.JAVA_HOME,
        },
    });

    const libs = join(checkout, "build", "libs");
    const jarName = readdirSync(libs).find((name) => name.endsWith("-all.jar"));
    if (!jarName) throw new Error("The semantic server build produced no all-in-one JAR.");
    const builtJar = join(libs, jarName);
    const digest = createHash("sha256").update(readFileSync(builtJar)).digest("hex");
    if (digest !== metadata.sha256) {
        throw new Error(`Unexpected semantic server SHA-256: ${digest}`);
    }

    const destination = join(repositoryRoot, "semantic-server", metadata.jar);
    cpSync(builtJar, destination);
    console.log(`Created ${basename(destination)} (${digest})`);
} finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
}
