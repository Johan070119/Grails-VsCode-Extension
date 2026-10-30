const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
    discoverGradleProjectModel,
    parseGradleProjectModel,
} = require("../dist/gradleProjectModel.js");

test("parses and deduplicates the Gradle project model marker", () => {
    const output = [
        "Gradle output",
        'GRAILS_VSCODE_MODEL:{"classpath":["/a.jar","/a.jar","/classes"],"sourceRoots":["/src/main/groovy"]}',
    ].join("\n");
    assert.deepEqual(parseGradleProjectModel(output), {
        classpath: ["/a.jar", "/classes"],
        sourceRoots: ["/src/main/groovy"],
    });
});

test("ignores malformed Gradle output", () => {
    assert.equal(parseGradleProjectModel("no marker"), null);
    assert.equal(parseGradleProjectModel("GRAILS_VSCODE_MODEL:{}"), null);
});

test(
    "runs gradlew.bat through cmd.exe from a path with spaces",
    { skip: process.platform !== "win32" },
    async (t) => {
        const parent = fs.mkdtempSync(path.join(os.tmpdir(), "grails gradle "));
        t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
        fs.writeFileSync(
            path.join(parent, "gradlew.bat"),
            '@echo GRAILS_VSCODE_MODEL:{"classpath":["a.jar"],"sourceRoots":["src"]}\r\n',
            "utf8",
        );
        const initScript = path.join(parent, "init script.gradle");
        fs.writeFileSync(initScript, "", "utf8");

        assert.deepEqual(await discoverGradleProjectModel(parent, initScript), {
            classpath: ["a.jar"],
            sourceRoots: ["src"],
        });
    },
);
