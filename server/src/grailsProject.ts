//server/src/grailsProject.ts
import * as fs from "fs";
import * as path from "path";

export interface DomainClass {
    name: string; // "Book"
    filePath: string;
    properties: DomainProperty[];
    hasMany: Record<string, string>; // { chapters: "Chapter" }
    belongsTo: Record<string, string>; // { author: "Author" }
}

export interface DomainProperty {
    name: string;
    type: string; // "String", "Integer", "Date", etc.
}

export interface GrailsArtifact {
    name: string; // "BookController", "BookService"
    simpleName: string; // "book"
    filePath: string;
    kind: "controller" | "service" | "taglib" | "domain";
}

export interface GrailsProject {
    root: string;
    domains: Map<string, DomainClass>; // "Book" -> DomainClass
    controllers: Map<string, GrailsArtifact>;
    services: Map<string, GrailsArtifact>;
    taglibs: Map<string, GrailsArtifact>;
}

// ─── Detection ──────────────────────────────────────────────────────────────

export function isGrailsProject(root: string): boolean {
    return fs.existsSync(path.join(root, "grails-app"));
}

export function findGrailsRoot(startPath: string): string | null {
    let current = startPath;
    for (let i = 0; i < 10; i++) {
        if (isGrailsProject(current)) return current;
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return null;
}

// ─── File scanning ───────────────────────────────────────────────────────────

function scanGroovyFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...scanGroovyFiles(full));
        } else if (entry.isFile() && entry.name.endsWith(".groovy")) {
            results.push(full);
        }
    }
    return results;
}

// ─── Domain class parsing ────────────────────────────────────────────────────

const PROPERTY_RE =
    /^\s+(String|Integer|int|Long|long|Double|double|Float|float|Boolean|boolean|Date|BigDecimal|byte\[\])\s+(\w+)/;
const HAS_MANY_RE = /static\s+hasMany\s*=\s*\[([^\]]+)\]/;
const BELONGS_TO_RE = /static\s+belongsTo\s*=\s*\[([^\]]+)\]/;
const RELATION_ENTRY_RE = /(\w+)\s*:\s*(\w+)/g;
const CLASS_NAME_RE = /class\s+(\w+)/;

function parseDomainClass(filePath: string): DomainClass | null {
    let src: string;
    try {
        src = fs.readFileSync(filePath, "utf8");
    } catch {
        return null;
    }

    const classMatch = CLASS_NAME_RE.exec(src);
    if (!classMatch) return null;
    const name = classMatch[1];

    const properties: DomainProperty[] = [];
    for (const line of src.split("\n")) {
        const m = PROPERTY_RE.exec(line);
        if (m) properties.push({ type: m[1], name: m[2] });
    }

    const hasMany: Record<string, string> = {};
    const hasManyMatch = HAS_MANY_RE.exec(src);
    if (hasManyMatch) {
        let m: RegExpExecArray | null;
        while ((m = RELATION_ENTRY_RE.exec(hasManyMatch[1])) !== null) {
            hasMany[m[1]] = m[2];
        }
    }

    const belongsTo: Record<string, string> = {};
    const belongsToMatch = BELONGS_TO_RE.exec(src);
    if (belongsToMatch) {
        RELATION_ENTRY_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = RELATION_ENTRY_RE.exec(belongsToMatch[1])) !== null) {
            belongsTo[m[1]] = m[2];
        }
    }

    return { name, filePath, properties, hasMany, belongsTo };
}

// ─── Artifact parsing ────────────────────────────────────────────────────────

function parseArtifact(
    filePath: string,
    kind: GrailsArtifact["kind"],
): GrailsArtifact | null {
    const fileName = path.basename(filePath, ".groovy");
    const src = (() => {
        try {
            return fs.readFileSync(filePath, "utf8");
        } catch {
            return "";
        }
    })();
    const classMatch = CLASS_NAME_RE.exec(src);
    const name = classMatch ? classMatch[1] : fileName;

    // "BookController" -> "book", "BookService" -> "book"
    const suffix =
        kind === "controller"
            ? "Controller"
            : kind === "service"
              ? "Service"
              : kind === "taglib"
                ? "TagLib"
                : "";
    const simpleName = name.endsWith(suffix)
        ? name.slice(0, -suffix.length).toLowerCase()
        : name.toLowerCase();

    return { name, simpleName, filePath, kind };
}

// ─── Project builder ─────────────────────────────────────────────────────────

export function buildGrailsProject(root: string): GrailsProject {
    const project: GrailsProject = {
        root,
        domains: new Map(),
        controllers: new Map(),
        services: new Map(),
        taglibs: new Map(),
    };

    // Domains
    for (const f of scanGroovyFiles(path.join(root, "grails-app/domain"))) {
        const d = parseDomainClass(f);
        if (d) project.domains.set(d.name, d);
    }

    // Controllers
    for (const f of scanGroovyFiles(
        path.join(root, "grails-app/controllers"),
    )) {
        const a = parseArtifact(f, "controller");
        if (a) project.controllers.set(a.name, a);
    }

    // Services
    for (const f of scanGroovyFiles(path.join(root, "grails-app/services"))) {
        const a = parseArtifact(f, "service");
        if (a) project.services.set(a.name, a);
    }

    // TagLibs
    for (const f of scanGroovyFiles(path.join(root, "grails-app/taglib"))) {
        const a = parseArtifact(f, "taglib");
        if (a) project.taglibs.set(a.name, a);
    }

    return project;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** "BookController.groovy" → "Book" */
export function controllerToDomain(controllerName: string): string {
    return controllerName.replace(/Controller$/, "");
}

/** Infer which domain class is in scope from a controller file path */
export function inferDomainFromController(
    filePath: string,
    project: GrailsProject,
): DomainClass | null {
    const ctrlName = path.basename(filePath, ".groovy");
    const domainName = controllerToDomain(ctrlName);
    return project.domains.get(domainName) ?? null;
}
