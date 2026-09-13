const assert = require("node:assert/strict");
const test = require("node:test");

const { locationKey, mergeByKey, mergeCompletionItems } = require("../dist/resultMerge.js");

test("completion merge preserves Grails priority and removes semantic duplicates", () => {
    const grails = [{ label: "get", detail: "GORM" }, { label: "findByTitle" }];
    const semantic = [{ label: "get", detail: "Groovy" }, { label: "wait" }];
    assert.deepEqual(mergeCompletionItems(grails, semantic), [
        grails[0],
        grails[1],
        semantic[1],
    ]);
});

test("completion merge keeps semantic overloads when Grails has no matching label", () => {
    const semantic = [
        { label: "wait", detail: "wait()" },
        { label: "wait", detail: "wait(long)" },
    ];
    assert.deepEqual(mergeCompletionItems([], semantic), semantic);
});

test("location merge removes identical definitions", () => {
    const location = {
        uri: "file:///Book.groovy",
        range: { start: { line: 1, character: 6 }, end: { line: 1, character: 10 } },
    };
    assert.deepEqual(mergeByKey([location], [{ ...location }], locationKey), [location]);
});
