const assert = require("node:assert/strict");
const test = require("node:test");

const { parseGradleProjectModel } = require("../dist/gradleProjectModel.js");

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
