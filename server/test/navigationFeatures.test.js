const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { TextDocument } = require("vscode-languageserver-textdocument");

const { buildGrailsProject } = require("../dist/grailsProject.js");
const {
    getCodeLenses,
    getReferences,
    getRenameEdit,
    incomingCalls,
    outgoingCalls,
    prepareCallHierarchy,
    prepareRename,
} = require("../dist/navigationFeatures.js");
const { pathToUri } = require("../dist/uriUtils.js");

function write(root, relative, contents) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents, "utf8");
    return file;
}

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "grails-navigation-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    write(root, "gradle.properties", "grailsVersion=7.1.1\n");
    const domain = write(root, "grails-app/domain/example/Book.groovy", "package example\nclass Book {\n String title\n}\n");
    const service = write(root, "grails-app/services/example/BookService.groovy", `package example
class BookService {
    Book loadBook(Long id) { Book.get(id) }
}
`);
    const controller = write(root, "grails-app/controllers/example/BookController.groovy", `package example
class BookController {
    BookService bookService
    def index() { bookService.loadBook(1L) }
    def show() { redirect(action: 'index') }
}
`);
    write(root, "grails-app/controllers/example/AuthorController.groovy", `package example
class AuthorController {
    def index = { render view: 'show' }
}
`);
    const view = write(root, "grails-app/views/book/show.gsp", '<g:link controller="book" action="index">Books</g:link>\n');
    write(root, "grails-app/views/author/show.gsp", '<g:link action="index">Authors</g:link>\n');
    write(root, "src/main/java/client/Reader.java", "package client;\nimport example.Book;\nclass Reader { Book book; }\n");
    write(root, "src/main/java/client/StaticReader.java", "package client;\nimport static example.Book.get;\nclass StaticReader {}\n");
    return { root, domain, service, controller, view, project: buildGrailsProject(root) };
}

function document(file) {
    return TextDocument.create(pathToUri(file), file.endsWith(".gsp") ? "gsp" : "groovy", 1, fs.readFileSync(file, "utf8"));
}

test("find references follows class and Grails controller conventions", (t) => {
    const { controller, view, project } = fixture(t);
    const doc = document(controller);
    const refs = getReferences(doc, { textDocument: { uri: doc.uri }, position: { line: 1, character: 8 } }, project, true);
    assert.equal(refs.some((location) => location.uri === pathToUri(controller)), true);
    assert.equal(refs.some((location) => location.uri === pathToUri(view)), true);
});

test("action references stay scoped to their controller", (t) => {
    const { controller, view, root, project } = fixture(t);
    const doc = document(controller);
    const refs = getReferences(doc, { textDocument: { uri: doc.uri }, position: { line: 3, character: 9 } }, project, true);
    assert.equal(refs.some((location) => location.uri === pathToUri(view)), true);
    assert.equal(refs.some((location) => location.uri.endsWith("/views/author/show.gsp")), false);
    assert.equal(refs.some((location) => location.uri === pathToUri(path.join(root, "grails-app/controllers/example/AuthorController.groovy"))), false);
});

test("action references ignore same-named JavaScript calls inside GSP files", (t) => {
    const { controller, view, project } = fixture(t);
    fs.appendFileSync(view, "<script>index()</script>\n", "utf8");
    const doc = document(controller);
    const refs = getReferences(doc, { textDocument: { uri: doc.uri }, position: { line: 3, character: 9 } }, project, true);
    const viewRefs = refs.filter((location) => location.uri === pathToUri(view));
    assert.equal(viewRefs.length, 1);
});

test("find references honors includeDeclaration=false", (t) => {
    const { controller, project } = fixture(t);
    const doc = document(controller);
    const refs = getReferences(doc, { textDocument: { uri: doc.uri }, position: { line: 1, character: 8 } }, project, false);
    assert.equal(refs.some((location) => location.uri === doc.uri && location.range.start.line === 1), false);
});

test("class rename updates class/conventional references and requests a file rename", (t) => {
    const { controller, view, project } = fixture(t);
    const doc = document(controller);
    const params = { textDocument: { uri: doc.uri }, position: { line: 1, character: 8 }, newName: "LibraryController" };
    assert.equal(prepareRename(doc, params, project).placeholder, "BookController");
    const edit = getRenameEdit(doc, params, project);
    const textChanges = edit.documentChanges.filter((change) => change.textDocument);
    const controllerEdit = textChanges.flatMap((change) => change.edits).find((change) => change.newText === "LibraryController");
    const logicalEdit = textChanges.find((change) => change.textDocument.uri === pathToUri(view)).edits.find((change) => change.newText === "library");
    const renameFile = edit.documentChanges.find((change) => change.kind === "rename");
    assert.ok(controllerEdit);
    assert.ok(logicalEdit);
    assert.match(renameFile.newUri, /LibraryController\.groovy$/);
});

test("class rename ignores visible GSP text but keeps Groovy expressions", (t) => {
    const { controller, view, project } = fixture(t);
    fs.appendFileSync(view, "<p>BookController</p>\n<p>${BookController.simpleName}</p>\n", "utf8");
    const doc = document(controller);
    const edit = getRenameEdit(doc, {
        textDocument: { uri: doc.uri }, position: { line: 1, character: 8 }, newName: "LibraryController",
    }, project);
    const viewChanges = edit.documentChanges.find((change) => change.textDocument?.uri === pathToUri(view));
    assert.equal(viewChanges.edits.some((change) => change.range.start.line === 1), false);
    assert.equal(viewChanges.edits.some((change) => change.range.start.line === 2 && change.newText === "LibraryController"), true);
});

test("view rename changes only references that resolve to the same GSP", (t) => {
    const { controller, view, project } = fixture(t);
    fs.appendFileSync(controller, "// render(view: 'show')\n", "utf8");
    const doc = document(controller);
    const edit = getRenameEdit(doc, { textDocument: { uri: doc.uri }, position: { line: 6, character: 18 }, newName: "details" }, project);
    assert.ok(edit);
    assert.equal(edit.documentChanges.some((change) => change.kind === "rename" && /details\.gsp$/.test(change.newUri)), true);
});

test("view rename is only offered on the GSP basename, not its controller folder", (t) => {
    const { controller, project } = fixture(t);
    fs.appendFileSync(controller, "// render(view: '/book/show.gsp')\n", "utf8");
    const doc = document(controller);
    const folder = { textDocument: { uri: doc.uri }, position: { line: 6, character: 19 } };
    const basename = { textDocument: { uri: doc.uri }, position: { line: 6, character: 25 } };
    assert.equal(prepareRename(doc, folder, project), null);
    assert.equal(prepareRename(doc, basename, project).placeholder, "show");
});

test("service rename preserves the injected camelCase convention", (t) => {
    const { service, controller, project } = fixture(t);
    const doc = document(service);
    const edit = getRenameEdit(doc, { textDocument: { uri: doc.uri }, position: { line: 1, character: 8 }, newName: "LibraryService" }, project);
    const controllerChanges = edit.documentChanges.find((change) => change.textDocument?.uri === pathToUri(controller));
    assert.equal(controllerChanges.edits.some((change) => change.newText === "libraryService"), true);
    assert.equal(edit.documentChanges.some((change) => change.kind === "rename" && /LibraryService\.groovy$/.test(change.newUri)), true);
});

test("package rename updates declarations/imports and package directories", (t) => {
    const { domain, project } = fixture(t);
    const doc = document(domain);
    const prepared = prepareRename(doc, { textDocument: { uri: doc.uri }, position: { line: 0, character: 10 } }, project);
    assert.equal(prepared.placeholder, "example");
    const edit = getRenameEdit(doc, { textDocument: { uri: doc.uri }, position: { line: 0, character: 10 }, newName: "catalog" }, project);
    const changes = edit.documentChanges.filter((change) => change.textDocument);
    assert.equal(changes.flatMap((change) => change.edits).some((change) => change.newText === "catalog"), true);
    const staticImport = changes.find((change) => change.textDocument.uri.endsWith("/StaticReader.java"));
    assert.equal(staticImport.edits.some((change) => change.newText === "catalog"), true);
    assert.equal(edit.documentChanges.some((change) => change.kind === "rename" && /\/catalog$/.test(change.newUri)), true);
});

test("package rename is refused when a destination directory already exists", (t) => {
    const { root, domain, project } = fixture(t);
    fs.mkdirSync(path.join(root, "grails-app/domain/catalog"), { recursive: true });
    const doc = document(domain);
    const edit = getRenameEdit(doc, { textDocument: { uri: doc.uri }, position: { line: 0, character: 10 }, newName: "catalog" }, project);
    assert.equal(edit, null);
});

test("class rename is refused when a simple name is ambiguous", (t) => {
    const { root } = fixture(t);
    const first = write(root, "src/main/groovy/one/Report.groovy", "package one\nclass Report {}\n");
    write(root, "src/main/groovy/two/Report.groovy", "package two\nclass Report {}\n");
    const project = buildGrailsProject(root);
    const doc = document(first);
    const params = { textDocument: { uri: doc.uri }, position: { line: 1, character: 8 }, newName: "Summary" };
    assert.equal(prepareRename(doc, params, project), null);
    assert.equal(getRenameEdit(doc, params, project), null);
    assert.deepEqual(getReferences(doc, params, project, true), []);
});

test("call hierarchy resolves service incoming and outgoing calls", (t) => {
    const { service, controller, project } = fixture(t);
    const serviceDoc = document(service);
    const prepared = prepareCallHierarchy(serviceDoc, { textDocument: { uri: serviceDoc.uri }, position: { line: 2, character: 10 } }, project);
    assert.equal(prepared[0].name, "loadBook");
    const incoming = incomingCalls(prepared[0], project);
    assert.equal(incoming.some((call) => call.from.uri === pathToUri(controller) && call.from.name === "index"), true);

    const controllerDoc = document(controller);
    const caller = prepareCallHierarchy(controllerDoc, { textDocument: { uri: controllerDoc.uri }, position: { line: 3, character: 9 } }, project)[0];
    const outgoing = outgoingCalls(caller, project);
    assert.equal(outgoing.some((call) => call.to.uri === pathToUri(service) && call.to.name === "loadBook"), true);
});

test("incoming call hierarchy excludes unrelated same-named methods", (t) => {
    const { root, service } = fixture(t);
    write(root, "grails-app/services/example/OtherService.groovy", `package example
class OtherService { def loadBook() {} }
`);
    const unrelated = write(root, "grails-app/controllers/example/OtherController.groovy", `package example
class OtherController {
    OtherService otherService
    def index() { otherService.loadBook() }
}
`);
    const project = buildGrailsProject(root);
    const serviceDoc = document(service);
    const prepared = prepareCallHierarchy(serviceDoc, { textDocument: { uri: serviceDoc.uri }, position: { line: 2, character: 10 } }, project);
    const incoming = incomingCalls(prepared[0], project);
    assert.equal(incoming.some((call) => call.from.uri === pathToUri(unrelated)), false);
});

test("CodeLens exposes class and action reference indicators", (t) => {
    const { controller, view, project } = fixture(t);
    const lenses = getCodeLenses(document(controller), project);
    assert.equal(lenses.some((lens) => /referencia/.test(lens.command.title)), true);
    assert.equal(lenses.some((lens) => /uso.*acción/.test(lens.command.title)), true);
    const viewLenses = getCodeLenses(document(view), project);
    assert.equal(viewLenses.some((lens) => /BookController/.test(lens.command.title)), true);
});

test("legacy Grails closure actions participate in hierarchy and CodeLens", (t) => {
    const { root, project } = fixture(t);
    const author = path.join(root, "grails-app/controllers/example/AuthorController.groovy");
    const doc = document(author);
    const hierarchy = prepareCallHierarchy(doc, { textDocument: { uri: doc.uri }, position: { line: 2, character: 9 } }, project);
    assert.equal(hierarchy[0].name, "index");
    const lenses = getCodeLenses(doc, project);
    assert.equal(lenses.some((lens) => /uso.*acción/.test(lens.command.title)), true);
});
