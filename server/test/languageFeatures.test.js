const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { TextDocument } = require("vscode-languageserver-textdocument");

const { getCompletions } = require("../dist/completion.js");
const { getDefinition } = require("../dist/definition.js");
const { buildGrailsProject } = require("../dist/grailsProject.js");
const { getHover, getDocumentSymbols } = require("../dist/languageFeatures.js");
const { pathToUri } = require("../dist/uriUtils.js");

function write(root, relativePath, contents) {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents, "utf8");
    return filePath;
}

function setup(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "grails-vscode-language-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    write(root, "gradle.properties", "grailsVersion=7.1.1\n");
    write(
        root,
        "src/main/java/example/Slugger.java",
        "package example;\npublic class Slugger {\n    public String slug(String value) { return value; }\n}\n",
    );
    const consumer = write(
        root,
        "grails-app/services/example/ConsumerService.groovy",
        "package example\nclass ConsumerService {\n    Slugger slugger\n    def useIt() {\n        slugger.\n    }\n}\n",
    );
    return { root, consumer, project: buildGrailsProject(root) };
}

test("completes members from a project Java class", (t) => {
    const { consumer, project } = setup(t);
    const text = fs.readFileSync(consumer, "utf8");
    const document = TextDocument.create(pathToUri(consumer), "groovy", 1, text);
    const completions = getCompletions(
        document,
        { textDocument: { uri: document.uri }, position: { line: 4, character: 16 } },
        project,
    );
    assert.equal(completions.some((item) => item.label === "slug"), true);
});

test("navigates to a Java member and exposes hover/document symbols", (t) => {
    const { consumer, project } = setup(t);
    const callText = "package example\nclass Caller {\n Slugger slugger\n def call() { slugger.slug('x') }\n}\n";
    const document = TextDocument.create(pathToUri(consumer), "groovy", 1, callText);
    const position = { line: 3, character: 23 };
    const definition = getDefinition(
        document,
        { textDocument: { uri: document.uri }, position },
        project,
    );
    assert.ok(definition);
    assert.match(definition.uri, /Slugger\.java$/);
    assert.equal(definition.range.start.line, 2);

    const hover = getHover(
        document,
        { textDocument: { uri: document.uri }, position: { line: 2, character: 3 } },
        project,
    );
    assert.match(hover.contents.value, /example\.Slugger/);

    const indexedDocument = TextDocument.create(
        pathToUri(consumer),
        "groovy",
        1,
        fs.readFileSync(consumer, "utf8"),
    );
    const symbols = getDocumentSymbols(indexedDocument, project);
    assert.equal(symbols.some((symbol) => symbol.name === "ConsumerService"), true);
    assert.equal(symbols.some((symbol) => symbol.name === "useIt"), true);
});
