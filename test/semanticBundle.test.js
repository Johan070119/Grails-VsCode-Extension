const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("bundles the pinned semantic server with the expected digest", () => {
    const root = path.resolve(__dirname, "..");
    const metadata = JSON.parse(
        fs.readFileSync(path.join(root, "semantic-server", "upstream.json"), "utf8"),
    );
    const jar = fs.readFileSync(
        path.join(root, "semantic-server", metadata.jar),
    );
    const digest = createHash("sha256").update(jar).digest("hex");
    assert.equal(digest, metadata.sha256);
    assert.equal(metadata.commit.length, 40);
    assert.equal(metadata.license, "Apache-2.0");
});
