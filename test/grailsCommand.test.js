const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
    quoteTerminalArgument,
    resolveGrailsCommand,
} = require("../dist/grailsCommand.js");

test("prefers Grails Wrapper and uses fixed argument arrays", (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "grails-command-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, "grailsw"), "", "utf8");
    assert.deepEqual(resolveGrailsCommand(root, "runApp", "linux"), {
        executable: "./grailsw",
        args: ["run-app"],
        source: "grails-wrapper",
    });
});

test("falls back to Gradle Wrapper for a modern project", (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "grails-command-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, "gradlew"), "", "utf8");
    assert.deepEqual(resolveGrailsCommand(root, "runApp", "linux"), {
        executable: "./gradlew",
        args: ["bootRun"],
        source: "gradle-wrapper",
    });
    assert.equal(quoteTerminalArgument("value with spaces", "linux"), "'value with spaces'");
});
