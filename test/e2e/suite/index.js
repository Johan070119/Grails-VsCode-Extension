const assert = require("node:assert/strict");
const path = require("node:path");
const vscode = require("vscode");

async function eventually(operation, predicate, timeoutMs = 15_000) {
    const started = Date.now();
    let last;
    while (Date.now() - started < timeoutMs) {
        last = await operation();
        if (predicate(last)) return last;
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.fail(`Timed out waiting for VS Code provider result: ${JSON.stringify(last)}`);
}

function positionOf(document, needle, offset = 1) {
    const text = document.getText();
    const index = text.indexOf(needle);
    assert.notEqual(index, -1, `Missing test token: ${needle}`);
    return document.positionAt(index + offset);
}

async function open(relativePath) {
    const root = vscode.workspace.workspaceFolders[0].uri;
    const document = await vscode.workspace.openTextDocument(
        vscode.Uri.joinPath(root, ...relativePath.split("/")),
    );
    await vscode.window.showTextDocument(document);
    return document;
}

async function run() {
    const extension = vscode.extensions.getExtension(
        "JohanMixtegaCisneros.grails-extension-vscode",
    );
    assert.ok(extension, "The Grails extension was not loaded by Extension Host");
    await extension.activate();

    const probe = await open("src/main/groovy/example/Probe.groovy");
    const staticPosition = positionOf(probe, "Book.", "Book.".length);
    const staticCompletion = await eventually(
        () => vscode.commands.executeCommand(
            "vscode.executeCompletionItemProvider",
            probe.uri,
            staticPosition,
        ),
        (result) => result?.items?.some((item) => item.label === "get"),
    );
    assert.equal(staticCompletion.items.some((item) => item.label === "findByTitle"), true);

    const view = await open("grails-app/views/book/show.gsp");
    const actionPosition = positionOf(view, "index");
    const definitions = await eventually(
        () => vscode.commands.executeCommand(
            "vscode.executeDefinitionProvider",
            view.uri,
            actionPosition,
        ),
        (result) => Array.isArray(result) && result.length > 0,
    );
    assert.match(definitions[0].uri.fsPath, /BookController\.groovy$/);

    const domain = await open("grails-app/domain/example/Book.groovy");
    const domainPosition = positionOf(domain, "Book");
    const references = await vscode.commands.executeCommand(
        "vscode.executeReferenceProvider",
        domain.uri,
        domainPosition,
    );
    assert.equal(references.some((location) => location.uri.fsPath === probe.uri.fsPath), true);

    const unsavedText = `package example
class Probe {
    def run() {
        def book = Book.get(1)
        book.
    }
}
`;
    const editor = await vscode.window.showTextDocument(probe);
    await editor.edit((builder) => builder.replace(
        new vscode.Range(probe.positionAt(0), probe.positionAt(probe.getText().length)),
        unsavedText,
    ));
    assert.equal(probe.isDirty, true);
    const unsavedPosition = new vscode.Position(4, 13);
    const unsavedCompletion = await eventually(
        () => vscode.commands.executeCommand(
            "vscode.executeCompletionItemProvider",
            probe.uri,
            unsavedPosition,
        ),
        (result) => result?.items?.some((item) => item.label === "title"),
    );
    assert.equal(unsavedCompletion.items.some((item) => item.label === "title"), true);
    assert.equal(unsavedCompletion.items.filter((item) => item.label === "title").length, 1);

    const unsavedReferences = await eventually(
        () => vscode.commands.executeCommand(
            "vscode.executeReferenceProvider",
            domain.uri,
            domainPosition,
        ),
        (result) => result?.some(
            (location) => location.uri.fsPath === probe.uri.fsPath && location.range.start.line === 3,
        ),
    );
    assert.equal(unsavedReferences.some((location) => location.uri.fsPath === probe.uri.fsPath), true);

    const rename = await vscode.commands.executeCommand(
        "vscode.executeDocumentRenameProvider",
        domain.uri,
        domainPosition,
        "LibraryBook",
    );
    const probeEdits = rename.entries().find(([uri]) => uri.fsPath === probe.uri.fsPath)?.[1] ?? [];
    assert.equal(probeEdits.some((edit) => edit.range.start.line === 3), true);

    const lenses = await vscode.commands.executeCommand(
        "vscode.executeCodeLensProvider",
        (await open("grails-app/controllers/example/BookController.groovy")).uri,
    );
    assert.equal(lenses.some((lens) => /referencia|acción/.test(lens.command?.title ?? "")), true);
}

module.exports = { run };
