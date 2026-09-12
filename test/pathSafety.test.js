const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
    isPathWithin,
    isSafeEntryName,
    resolvePathWithin,
} = require("../dist/pathSafety.js");

test("keeps user-provided paths inside the selected project folder", () => {
    const root = path.resolve("/tmp/grails-project");
    assert.equal(
        resolvePathWithin(root, "example/admin/Book"),
        path.join(root, "example/admin/Book"),
    );
    assert.equal(resolvePathWithin(root, "../outside"), null);
    assert.equal(resolvePathWithin(root, "/absolute"), null);
    assert.equal(isPathWithin(root, path.join(root, "inside")), true);
    assert.equal(isPathWithin(root, path.resolve(root, "../outside")), false);
});

test("accepts a rename entry, not a path", () => {
    assert.equal(isSafeEntryName("BookService.groovy"), true);
    assert.equal(isSafeEntryName(".."), false);
    assert.equal(isSafeEntryName("../BookService.groovy"), false);
    assert.equal(isSafeEntryName("nested/BookService.groovy"), false);
});
