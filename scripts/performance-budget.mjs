import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const require = createRequire(import.meta.url);
const { TextDocument } = require("../server/node_modules/vscode-languageserver-textdocument");
const { buildGrailsProject } = require("../server/dist/grailsProject.js");
const { getCompletions } = require("../server/dist/completion.js");
const { getReferences } = require("../server/dist/navigationFeatures.js");
const { pathToUri } = require("../server/dist/uriUtils.js");

const budgets = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "performance-budgets.json"), "utf8"));
const requested = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const defaultProjects = [
    process.env.GRAILS_TIMESHARE7_PATH || path.resolve(repositoryRoot, "../../TimeShare7"),
    process.env.GRAILS_TIMESHARE_PATH || path.resolve(repositoryRoot, "../../TimeShare"),
];
const projectRoots = (requested.length > 0 ? requested : defaultProjects)
    .map((projectRoot) => path.resolve(projectRoot))
    .filter((projectRoot) => fs.existsSync(path.join(projectRoot, "grails-app")));

if (projectRoots.length === 0) {
    console.log("No Grails performance projects were found; pass project paths explicitly.");
    process.exit(0);
}

function positionAt(text, offset) {
    const before = text.slice(0, offset);
    const line = before.split("\n").length - 1;
    return { line, character: offset - (before.lastIndexOf("\n") + 1) };
}

let failed = false;
const results = [];
for (const projectRoot of projectRoots) {
    const name = path.basename(projectRoot);
    const budget = { ...budgets.default, ...(budgets[name] ?? {}) };
    const rssBefore = process.memoryUsage().rss;
    const modelStarted = performance.now();
    const project = buildGrailsProject(projectRoot);
    const projectModelMs = performance.now() - modelStarted;
    const domain = [...project.domains.values()].find(
        (candidate) => (project.sourceClassesBySimpleName.get(candidate.name) ?? []).length === 1,
    );
    if (!domain) throw new Error(`${name} does not contain an unambiguous domain class.`);

    const domainText = fs.readFileSync(domain.filePath, "utf8");
    const declarationOffset = domainText.search(new RegExp(`\\b${domain.name}\\b`));
    const domainDocument = TextDocument.create(pathToUri(domain.filePath), "groovy", 1, domainText);
    const referenceParams = {
        textDocument: { uri: domainDocument.uri },
        position: positionAt(domainText, declarationOffset),
    };
    const coldReferencesStarted = performance.now();
    const references = getReferences(domainDocument, referenceParams, project, true);
    const coldReferencesMs = performance.now() - coldReferencesStarted;
    const referencesStarted = performance.now();
    getReferences(domainDocument, referenceParams, project, true);
    const referencesMs = performance.now() - referencesStarted;

    const completionLine = `class Scratch { def probe() { ${domain.name}.`;
    const completionText = `package ${domain.packageName}\n${completionLine}`;
    const completionUri = pathToUri(path.join(projectRoot, ".grails-vscode-performance.groovy"));
    const completionDocument = TextDocument.create(completionUri, "groovy", 1, completionText);
    const completionStarted = performance.now();
    const completions = getCompletions(completionDocument, {
        textDocument: { uri: completionUri },
        position: { line: 1, character: completionLine.length },
    }, project);
    const completionMs = performance.now() - completionStarted;
    const labels = new Set(completions.map((item) => String(item.label)));
    const maxRssMb = (process.memoryUsage().rss - rssBefore) / 1024 / 1024;
    const checks = {
        projectModelMs: projectModelMs <= budget.projectModelMs,
        coldReferencesMs: coldReferencesMs <= budget.coldReferencesMs,
        referencesMs: referencesMs <= budget.referencesMs,
        completionMs: completionMs <= budget.completionMs,
        maxRssMb: maxRssMb <= budget.maxRssMb,
        gorm: labels.has("get") && labels.has("getAll") && [...labels].some((label) => label.startsWith("findBy")),
    };
    if (Object.values(checks).some((passed) => !passed)) failed = true;
    results.push({
        project: name,
        grailsVersion: project.versionInfo.raw,
        indexedTypes: project.sourceClasses.size,
        domain: domain.qualifiedName,
        references: references.length,
        projectModelMs: Number(projectModelMs.toFixed(1)),
        coldReferencesMs: Number(coldReferencesMs.toFixed(1)),
        referencesMs: Number(referencesMs.toFixed(1)),
        completionMs: Number(completionMs.toFixed(1)),
        maxRssMb: Number(maxRssMb.toFixed(1)),
        budget,
        checks,
    });
}

console.log(JSON.stringify(results, null, 2));
if (failed) process.exitCode = 1;
