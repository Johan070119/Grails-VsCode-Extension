const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { TextDocument } = require("vscode-languageserver-textdocument");

const { getCompletions } = require("../dist/completion.js");
const { getDefinition } = require("../dist/definition.js");
const { buildGrailsProject } = require("../dist/grailsProject.js");
const { getGspDiagnostics } = require("../dist/gspFeatures.js");
const { getHover } = require("../dist/languageFeatures.js");
const { pathToUri } = require("../dist/uriUtils.js");

function write(root, relative, contents) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents, "utf8");
    return file;
}

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "grails7-features-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    write(root, "gradle.properties", "grailsVersion=7.1.1\n");
    const domain = write(root, "grails-app/domain/example/Book.groovy", `package example
class Book {
    String title
    Integer pages
    static hasMany = [authors: Author]
    static transients = ['displayTitle']
    static constraints = {
        title nullable: false, blank: false
    }
}
`);
    const controller = write(root, "grails-app/controllers/example/BookController.groovy", `package example
class BookController {
    def index() {}
    def show(Long id) {}
}
`);
    write(root, "grails-app/taglib/example/AppTagLib.groovy", `package example
class AppTagLib {
    static namespace = 'app'
    def badge = { attrs, body -> out << body() }
}
`);
    const view = write(root, "grails-app/views/book/index.gsp", "");
    write(root, "grails-app/views/book/_row.gsp", "<div>${book.title}</div>\n");
    write(root, "grails-app/views/layouts/main.gsp", "<html><body><g:layoutBody/></body></html>\n");
    write(root, "grails-app/assets/javascripts/application.js", "console.log('app')\n");
    return { root, domain, controller, view, project: buildGrailsProject(root) };
}

function complete(file, language, text, project) {
    const document = TextDocument.create(pathToUri(file), language, 1, text);
    const lines = text.split("\n");
    const position = { line: lines.length - 1, character: lines.at(-1).length };
    return { document, position, items: getCompletions(document, { textDocument: { uri: document.uri }, position }, project) };
}

test("models constraints/transients and completes Grails 7 GORM DSLs", (t) => {
    const { domain, project } = fixture(t);
    const book = project.domains.get("Book");
    assert.deepEqual(book.constraints.title, ["nullable", "blank"]);
    assert.deepEqual(book.transients, ["displayTitle"]);

    let result = complete(domain, "groovy", "class Book {\n String title\n static constraints = {\n  title ", project);
    assert.equal(result.items.some((item) => item.label === "nullable"), true);
    assert.equal(result.items.some((item) => item.label === "validator"), true);

    result = complete(domain, "groovy", "class Book {\n String title\n static mapping = {\n  ", project);
    assert.equal(result.items.some((item) => item.label === "table"), true);
    assert.equal(result.items.some((item) => item.label === "title"), true);

    result = complete(domain, "groovy", "import example.Book\nBook.withCriteria {\n  ", project);
    assert.equal(result.items.some((item) => item.label === "ilike"), true);
    assert.equal(result.items.some((item) => item.label === "projections"), true);
});

test("completes dynamic finders and instance association helpers", (t) => {
    const { domain, project } = fixture(t);
    let result = complete(domain, "groovy", "import example.Book\nBook.", project);
    assert.equal(result.items.some((item) => item.label === "getAll"), true);
    assert.equal(result.items.some((item) => item.label === "findByTitleIlike"), true);
    assert.equal(result.items.some((item) => item.label === "whereAny"), true);

    result = complete(domain, "groovy", "def book = new Book()\nbook.", project);
    assert.equal(result.items.some((item) => item.label === "addToAuthors"), true);
    assert.equal(result.items.some((item) => item.label === "getDirtyPropertyNames"), true);
});

test("completes GSP tags, attributes and controller actions", (t) => {
    const { view, project } = fixture(t);
    let result = complete(view, "gsp", "<g:li", project);
    assert.equal(result.items.some((item) => item.label === "g:link"), true);

    result = complete(view, "gsp", "<g:link ", project);
    assert.equal(result.items.some((item) => item.label === "controller"), true);
    assert.equal(result.items.some((item) => item.label === "action"), true);

    result = complete(view, "gsp", '<g:link controller="book" action="', project);
    assert.equal(result.items.some((item) => item.label === "index"), true);
    assert.equal(result.items.some((item) => item.label === "show"), true);
});

test("navigates across GSP templates, TagLibs, controllers and assets", (t) => {
    const { view, controller, project } = fixture(t);
    const cases = [
        ["<g:render template=\"row\"/>", /_row\.gsp$/],
        ["<app:badge>New</app:badge>", /AppTagLib\.groovy$/],
        ["<g:link controller=\"book\" action=\"show\">Show</g:link>", /BookController\.groovy$/],
        ["<asset:javascript src=\"javascripts/application.js\"/>", /application\.js$/],
    ];
    for (const [text, expected] of cases) {
        const document = TextDocument.create(pathToUri(view), "gsp", 1, text);
        const definition = getDefinition(document, { textDocument: { uri: document.uri }, position: { line: 0, character: 5 } }, project);
        assert.ok(definition, text);
        assert.match(definition.uri, expected);
    }

    const actionDocument = TextDocument.create(pathToUri(view), "gsp", 1, cases[2][0]);
    const actionDefinition = getDefinition(actionDocument, { textDocument: { uri: actionDocument.uri }, position: { line: 0, character: 42 } }, project);
    assert.equal(actionDefinition.uri, pathToUri(controller));
    assert.equal(actionDefinition.range.start.line, 3);
});

test("provides GSP hover and diagnostics for invalid references", (t) => {
    const { view, project } = fixture(t);
    const document = TextDocument.create(pathToUri(view), "gsp", 1, '<g:link controller="missing">x</g:link>\n<g:render/>');
    const hover = getHover(document, { textDocument: { uri: document.uri }, position: { line: 0, character: 3 } }, project);
    assert.match(hover.contents.value, /Grails-aware HTML link/);
    const diagnostics = getGspDiagnostics(document, project);
    assert.equal(diagnostics.some((item) => /does not exist/.test(item.message)), true);
    assert.equal(diagnostics.some((item) => /requires the 'template'/.test(item.message)), true);
});
