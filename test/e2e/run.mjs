import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "../..");

try {
    await runTests({
        extensionDevelopmentPath: repositoryRoot,
        extensionTestsPath: path.join(testDirectory, "suite", "index.js"),
        launchArgs: [
            path.join(testDirectory, "fixture"),
            "--disable-extensions",
            "--disable-workspace-trust",
            "--skip-welcome",
            "--skip-release-notes",
        ],
        version: process.env.VSCODE_TEST_VERSION || "stable",
        extensionTestsEnv: process.env.GRAILS_SEMANTIC_JAVA_HOME
            ? { ...process.env, JAVA_HOME: process.env.GRAILS_SEMANTIC_JAVA_HOME }
            : process.env,
    });
} catch (error) {
    console.error("VS Code Extension Host tests failed:", error);
    process.exitCode = 1;
}
