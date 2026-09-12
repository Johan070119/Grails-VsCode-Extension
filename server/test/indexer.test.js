const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { GrailsIndexer } = require("../dist/indexer.js");

function makeProject(parent, name, version) {
    const root = path.join(parent, name);
    fs.mkdirSync(path.join(root, "grails-app", "domain"), { recursive: true });
    fs.writeFileSync(
        path.join(root, "gradle.properties"),
        `grailsVersion=${version}\n`,
        "utf8",
    );
    fs.writeFileSync(
        path.join(root, "grails-app", "domain", `${name}.groovy`),
        `class ${name} { String name }\n`,
        "utf8",
    );
    return root;
}

test("selects the project with the longest matching workspace root", (t) => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "grails-indexer-"));
    t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
    const first = makeProject(parent, "First", "7.1.1");
    const second = makeProject(parent, "Second", "6.2.3");
    const messages = [];
    const indexer = new GrailsIndexer({
        console: {
            log: (message) => messages.push(message),
            error: (message) => messages.push(message),
        },
    });
    t.after(() => indexer.dispose());

    indexer.initialize([first, second]);
    assert.equal(indexer.getProjects().length, 2);
    assert.equal(
        indexer.getProject(path.join(second, "grails-app/domain/Second.groovy"))
            .versionInfo.raw,
        "6.2.3",
    );
    assert.equal(messages.some((message) => message.includes("First")), true);
    assert.equal(messages.some((message) => message.includes("Second")), true);
});

test("does not re-add a workspace removed while an update is pending", async (t) => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "grails-indexer-remove-"));
    t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
    const root = makeProject(parent, "Pending", "7.1.1");
    const indexer = new GrailsIndexer({
        console: { log: () => undefined, error: () => undefined },
    });
    t.after(() => indexer.dispose());

    indexer.initialize([root]);
    indexer.onFileChanged(path.join(root, "gradle.properties"));
    indexer.removeWorkspaceFolder(root);
    await new Promise((resolve) => setTimeout(resolve, 400));

    assert.equal(indexer.getProjects().length, 0);
});
