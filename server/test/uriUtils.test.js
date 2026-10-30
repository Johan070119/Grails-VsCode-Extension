const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { uriToPath } = require("../dist/uriUtils.js");

test("converts a Windows URI whose drive colon is percent-encoded", () => {
    assert.equal(
        uriToPath("file:///c%3A/work/my%20app/grails-app"),
        path.normalize("c:/work/my app/grails-app"),
    );
});

test("converts a Windows URI with a literal drive colon", () => {
    assert.equal(
        uriToPath("file:///C:/work/app/grails-app"),
        path.normalize("C:/work/app/grails-app"),
    );
});

test("keeps the leading slash of POSIX paths", () => {
    assert.equal(
        uriToPath("file:///home/dev/my%20app"),
        path.normalize("/home/dev/my app"),
    );
});
