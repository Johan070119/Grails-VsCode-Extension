const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
    buildGrailsProject,
    detectGrailsVersionInfo,
    updateGrailsProjectFile,
} = require("../dist/grailsProject.js");

function write(root, relativePath, contents) {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents, "utf8");
    return filePath;
}

function fixture() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "grails-vscode-test-"));
}

test("detects the exact Grails 7 version and indexes Groovy and Java", (t) => {
    const root = fixture();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    write(root, "gradle.properties", "grailsVersion=7.1.1\n");
    write(
        root,
        "build.gradle",
        'implementation platform("org.apache.grails:grails-bom:$grailsVersion")\n' +
            'implementation "org.apache.grails:grails-core"\n',
    );
    write(
        root,
        "grails-app/domain/example/Book.groovy",
        "package example\n\nclass Book {\n    String title\n    static hasMany = [authors: Author]\n}\n",
    );
    write(
        root,
        "src/main/java/example/Slugger.java",
        "package example;\npublic class Slugger {\n    private String prefix;\n    public String slug(String value) { return value; }\n}\n",
    );

    const version = detectGrailsVersionInfo(root);
    assert.deepEqual(version, {
        raw: "7.1.1",
        major: "7+",
        source: "gradle.properties",
    });

    const project = buildGrailsProject(root);
    assert.equal(project.versionInfo.raw, "7.1.1");
    assert.equal(project.domains.get("Book").qualifiedName, "example.Book");
    assert.equal(project.domains.get("Book").properties[0].name, "title");
    assert.ok(project.sourceClasses.has("example.Book"));
    assert.ok(project.sourceClasses.has("example.Slugger"));
    assert.equal(
        project.sourceClasses.get("example.Slugger").members.some(
            (member) => member.name === "slug" && member.kind === "method",
        ),
        true,
    );
    assert.equal(
        project.dependencies.some(
            (dependency) =>
                dependency.group === "org.apache.grails" &&
                dependency.artifact === "grails-core",
        ),
        true,
    );
});

test("keeps Grails 2 detection as a compatibility lane", (t) => {
    const root = fixture();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    write(
        root,
        "application.properties",
        "app.grails.version=2.5.6\napp.name=legacy\n",
    );
    write(
        root,
        "grails-app/controllers/legacy/BookController.groovy",
        "package legacy\nclass BookController { def index() {} }\n",
    );

    const project = buildGrailsProject(root);
    assert.equal(project.version, "2");
    assert.equal(project.versionInfo.raw, "2.5.6");
    assert.equal(
        project.controllers.get("BookController").qualifiedName,
        "legacy.BookController",
    );
});

test("updates one source file without rebuilding the project model", (t) => {
    const root = fixture();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    write(root, "gradle.properties", "grailsVersion=7.1.1\n");
    const servicePath = write(
        root,
        "grails-app/services/example/BookService.groovy",
        "package example\nclass BookService { def first() {} }\n",
    );
    const project = buildGrailsProject(root);
    assert.equal(project.services.has("BookService"), true);

    write(
        root,
        "grails-app/services/example/BookService.groovy",
        "package example\nclass LibraryService { def second() {} }\n",
    );
    updateGrailsProjectFile(project, servicePath);
    assert.equal(project.services.has("BookService"), false);
    assert.equal(project.services.has("LibraryService"), true);
    assert.equal(project.sourceClasses.has("example.LibraryService"), true);

    fs.unlinkSync(servicePath);
    updateGrailsProjectFile(project, servicePath);
    assert.equal(project.services.has("LibraryService"), false);
    assert.equal(project.sourceClasses.has("example.LibraryService"), false);
});
