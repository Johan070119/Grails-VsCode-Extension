const assert = require("node:assert/strict");
const { fork } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
    IPCMessageReader,
    IPCMessageWriter,
    createMessageConnection,
} = require("vscode-jsonrpc/node");

const { pathToUri } = require("../dist/uriUtils.js");

function write(root, relative, contents) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents, "utf8");
    return file;
}

function startLanguageServer(t) {
    const server = path.join(__dirname, "../dist/server.js");
    const child = fork(server, ["--node-ipc"], {
        silent: true,
    });
    let stderr = "";
    child.stderr.on("data", (data) => { stderr += data.toString("utf8"); });
    child.on("exit", (code, signal) => { stderr += `\nserver exit: code=${code} signal=${signal}`; });
    const connection = createMessageConnection(
        new IPCMessageReader(child),
        new IPCMessageWriter(child),
    );
    connection.listen();
    const request = (method, params) => new Promise((resolve, reject) => {
        const timeout = setTimeout(
            () => reject(new Error(`Timeout waiting for ${method}\n${stderr}`)),
            10_000,
        );
        connection.sendRequest(method, params).then(
            (result) => { clearTimeout(timeout); resolve(result); },
            (error) => { clearTimeout(timeout); reject(error); },
        );
    });
    const notify = (method, params) => connection.sendNotification(method, params);

    t.after(() => {
        connection.dispose();
        if (!child.killed) child.kill();
    });
    return { child, notify, request };
}

test("the LSP protocol exposes and serves phase 4/5 navigation features", async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "grails-lsp-protocol-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    write(root, "gradle.properties", "grailsVersion=7.1.1\n");
    const domain = write(root, "grails-app/domain/example/Book.groovy", `package example
class Book {
    String title
}
`);
    const controller = write(root, "grails-app/controllers/example/BookController.groovy", `package example
class BookController {
    def index() { render view: 'show' }
}
`);
    const viewText = '<g:link controller="book" action="index">Books</g:link>\n';
    const view = write(root, "grails-app/views/book/show.gsp", viewText);
    const client = startLanguageServer(t);

    const initialized = await client.request("initialize", {
        processId: null,
        rootUri: pathToUri(root),
        capabilities: {},
        workspaceFolders: [{ uri: pathToUri(root), name: "fixture" }],
    });
    assert.equal(initialized.capabilities.referencesProvider, true);
    assert.equal(initialized.capabilities.renameProvider.prepareProvider, true);
    assert.equal(initialized.capabilities.callHierarchyProvider, true);
    assert.equal(initialized.capabilities.codeLensProvider.resolveProvider, false);
    client.notify("initialized", {});

    const controllerUri = pathToUri(controller);
    const controllerText = fs.readFileSync(controller, "utf8");
    client.notify("textDocument/didOpen", {
        textDocument: { uri: controllerUri, languageId: "groovy", version: 1, text: controllerText },
    });
    const position = { line: 1, character: 8 };
    const references = await client.request("textDocument/references", {
        textDocument: { uri: controllerUri }, position, context: { includeDeclaration: true },
    });
    assert.equal(references.some((location) => location.uri === pathToUri(view)), true);

    const rename = await client.request("textDocument/prepareRename", {
        textDocument: { uri: controllerUri }, position,
    });
    assert.equal(rename.placeholder, "BookController");
    const hierarchy = await client.request("textDocument/prepareCallHierarchy", {
        textDocument: { uri: controllerUri }, position: { line: 2, character: 9 },
    });
    assert.equal(hierarchy[0].name, "index");
    const lenses = await client.request("textDocument/codeLens", { textDocument: { uri: controllerUri } });
    assert.equal(lenses.some((lens) => /referencia/.test(lens.command.title)), true);
    const symbols = await client.request("textDocument/documentSymbol", { textDocument: { uri: controllerUri } });
    assert.equal(symbols.some((symbol) => symbol.name === "index"), true);

    const viewUri = pathToUri(view);
    client.notify("textDocument/didOpen", {
        textDocument: { uri: viewUri, languageId: "gsp", version: 1, text: viewText },
    });
    const definition = await client.request("textDocument/definition", {
        textDocument: { uri: viewUri },
        position: { line: 0, character: viewText.indexOf("index") + 1 },
    });
    assert.equal(definition.uri, controllerUri);
    assert.equal(definition.range.start.line, 2);

    const unsavedControllerText = `package example
class BookController {
    def index() { render view: 'show' }
    def unsaved() {
        def book = Book.get(1)
        book.
    }
}
`;
    client.notify("textDocument/didChange", {
        textDocument: { uri: controllerUri, version: 2 },
        contentChanges: [{ text: unsavedControllerText }],
    });
    const domainUri = pathToUri(domain);
    const domainText = fs.readFileSync(domain, "utf8");
    client.notify("textDocument/didOpen", {
        textDocument: { uri: domainUri, languageId: "groovy", version: 1, text: domainText },
    });
    const unsavedReferences = await client.request("textDocument/references", {
        textDocument: { uri: domainUri },
        position: { line: 1, character: 8 },
        context: { includeDeclaration: true },
    });
    assert.equal(unsavedReferences.some((location) => location.uri === controllerUri && location.range.start.line === 4), true);
    const unsavedCompletion = await client.request("textDocument/completion", {
        textDocument: { uri: controllerUri },
        position: { line: 5, character: 13 },
        context: { triggerKind: 1 },
    });
    assert.equal(unsavedCompletion.some((item) => item.label === "title"), true);
    const unsavedRename = await client.request("textDocument/rename", {
        textDocument: { uri: domainUri },
        position: { line: 1, character: 8 },
        newName: "LibraryBook",
    });
    const unsavedControllerChanges = unsavedRename.documentChanges.find(
        (change) => change.textDocument?.uri === controllerUri,
    );
    assert.equal(unsavedControllerChanges.edits.some((edit) => edit.range.start.line === 4), true);

    await client.request("shutdown", null);
    client.notify("exit");
});
