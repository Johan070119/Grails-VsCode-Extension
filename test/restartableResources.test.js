const assert = require("node:assert/strict");
const test = require("node:test");

const { RestartableResources } = require("../dist/restartableResources.js");

test("restart keeps only the newest generation and stops stale resources", async () => {
    const stopped = [];
    let releaseFirst;
    let call = 0;
    const resources = new RestartableResources(
        async (signal) => {
            call++;
            if (call === 1) {
                await new Promise((resolve) => {
                    releaseFirst = resolve;
                    signal.addEventListener("abort", resolve, { once: true });
                });
                return ["stale"];
            }
            return ["current"];
        },
        async (resource) => { stopped.push(resource); },
    );

    const first = resources.restart();
    await new Promise((resolve) => setImmediate(resolve));
    const second = resources.restart();
    releaseFirst?.();
    await Promise.all([first, second]);
    assert.deepEqual(resources.getAll(), ["current"]);
    assert.deepEqual(stopped, ["stale"]);
    await resources.dispose();
    assert.deepEqual(stopped, ["stale", "current"]);
});

test("dispose aborts startup and is idempotent", async () => {
    let aborted = false;
    const resources = new RestartableResources(
        async (signal) => {
            await new Promise((resolve) => signal.addEventListener("abort", () => {
                aborted = true;
                resolve();
            }, { once: true }));
            return [];
        },
        async () => undefined,
    );
    const start = resources.restart();
    await new Promise((resolve) => setImmediate(resolve));
    await resources.dispose();
    await start;
    await resources.dispose();
    assert.equal(aborted, true);
    assert.deepEqual(resources.getAll(), []);
});
