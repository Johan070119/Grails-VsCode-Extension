import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function listZipEntries(archive) {
    let end = -1;
    const minimum = Math.max(0, archive.length - 65_557);
    for (let offset = archive.length - 22; offset >= minimum; offset--) {
        if (archive.readUInt32LE(offset) === 0x06054b50) {
            end = offset;
            break;
        }
    }
    if (end < 0) throw new Error("Invalid VSIX: end-of-central-directory record not found.");
    const entries = archive.readUInt16LE(end + 10);
    let offset = archive.readUInt32LE(end + 16);
    const names = [];
    for (let index = 0; index < entries; index++) {
        if (archive.readUInt32LE(offset) !== 0x02014b50)
            throw new Error("Invalid VSIX: malformed central directory.");
        const nameLength = archive.readUInt16LE(offset + 28);
        const extraLength = archive.readUInt16LE(offset + 30);
        const commentLength = archive.readUInt16LE(offset + 32);
        names.push(archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return names;
}

export function verifyVsix(vsixPath) {
    const names = new Set(listZipEntries(fs.readFileSync(vsixPath)));
    const required = [
        "extension/package.json",
        "extension/LICENSE.md",
        "extension/NOTICE",
        "extension/semantic-server/README.md",
        "extension/semantic-server/upstream.json",
        "extension/semantic-server/groovy-language-server-all.jar",
        "extension/server/dist/server.js",
        "extension/dist/extension.js",
    ];
    const missing = required.filter((entry) => !names.has(entry));
    if (missing.length > 0) throw new Error(`VSIX is missing required files: ${missing.join(", ")}`);
    const forbidden = [...names].filter((entry) =>
        /^(?:extension\/)?(?:src|test|server\/src|server\/test)\//.test(entry) || /\.map$/.test(entry),
    );
    if (forbidden.length > 0) throw new Error(`VSIX contains development files: ${forbidden.join(", ")}`);
    return { files: names.size, required: required.length };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
    const vsixPath = process.argv[2];
    if (!vsixPath) throw new Error("Usage: node scripts/verify-vsix.mjs <extension.vsix>");
    const result = verifyVsix(path.resolve(vsixPath));
    console.log(`Verified ${path.resolve(vsixPath)} (${result.files} files, ${result.required} required files present).`);
}
