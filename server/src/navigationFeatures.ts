import * as fs from "fs";
import * as path from "path";
import {
    CallHierarchyIncomingCall,
    CallHierarchyItem,
    CallHierarchyOutgoingCall,
    CodeLens,
    Location,
    Position,
    Range,
    RenameParams,
    SymbolKind,
    TextDocumentPositionParams,
    TextEdit,
    WorkspaceEdit,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { getDefinition } from "./definition";
import { GrailsArtifact, GrailsProject, SourceClass, readFileSafe } from "./grailsProject";
import { pathToUri, uriToPath } from "./uriUtils";

interface RenameTarget {
    kind: "class" | "action" | "view" | "package";
    name: string;
    range: Range;
    definitionPath: string;
    controllerName?: string;
}

interface HierarchyData {
    root: string;
    uri: string;
    name: string;
    line: number;
}

const SKIP_DIRECTORIES = new Set([".git", ".gradle", ".idea", ".vscode", "build", "target", "out", "node_modules"]);
const SOURCE_EXTENSIONS = new Set([".groovy", ".java", ".gsp"]);

function read(filePath: string): string {
    return readFileSafe(filePath);
}

function projectFiles(project: GrailsProject): string[] {
    const files = new Set<string>(
        [...project.sourceClasses.values()].map((sourceClass) => sourceClass.filePath),
    );
    for (const collection of [project.controllers, project.services, project.taglibs]) {
        for (const artifact of collection.values()) files.add(artifact.filePath);
    }
    for (const domain of project.domains.values()) files.add(domain.filePath);
    const visit = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (!SKIP_DIRECTORIES.has(entry.name)) visit(path.join(dir, entry.name));
            } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.add(path.join(dir, entry.name));
        }
    };
    // GSP files and classless configuration scripts are not represented by SourceClass.
    [
        path.join(project.root, "grails-app", "views"),
        path.join(project.root, "grails-app", "conf"),
        path.join(project.root, "web-app"),
    ].forEach(visit);
    return [...files];
}

function identifierAt(document: TextDocument, position: Position): { word: string; range: Range } | null {
    const line = document.getText().split("\n")[position.line] ?? "";
    let start = Math.min(position.character, line.length);
    let end = start;
    while (start > 0 && /[\w-]/.test(line[start - 1])) start--;
    while (end < line.length && /[\w-]/.test(line[end])) end++;
    if (start === end) return null;
    return { word: line.slice(start, end), range: Range.create(position.line, start, position.line, end) };
}

function findLocations(filePath: string, pattern: RegExp, capture = 0): Location[] {
    const locations: Location[] = [];
    const text = read(filePath);
    if (!text) return locations;
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const matcher = new RegExp(pattern.source, flags);
    let match: RegExpExecArray | null = matcher.exec(text);
    if (!match) return locations;
    const lineStarts = [0];
    for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) lineStarts.push(index + 1);
    const positionAt = (offset: number): Position => {
        let low = 0;
        let high = lineStarts.length;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (lineStarts[middle] > offset) high = middle;
            else low = middle + 1;
        }
        const line = Math.max(0, low - 1);
        return Position.create(line, offset - lineStarts[line]);
    };
    while (match !== null) {
        const value = match[capture] ?? match[0];
        const offset = match.index + match[0].indexOf(value);
        const start = positionAt(offset);
        locations.push(Location.create(pathToUri(filePath), Range.create(start, positionAt(offset + value.length))));
        if (match[0].length === 0) matcher.lastIndex++;
        match = matcher.exec(text);
    }
    return locations;
}

function locationsFromOffsets(filePath: string, text: string, offsets: Array<{ start: number; length: number }>): Location[] {
    if (offsets.length === 0) return [];
    const lineStarts = [0];
    for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) lineStarts.push(index + 1);
    const positionAt = (offset: number): Position => {
        let low = 0;
        let high = lineStarts.length;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (lineStarts[middle] > offset) high = middle;
            else low = middle + 1;
        }
        const line = Math.max(0, low - 1);
        return Position.create(line, offset - lineStarts[line]);
    };
    return offsets.map(({ start, length }) =>
        Location.create(pathToUri(filePath), Range.create(positionAt(start), positionAt(start + length))),
    );
}

function gspExpressionReferences(filePath: string, name: string): Location[] {
    const text = read(filePath);
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const offsets: Array<{ start: number; length: number }> = [];
    for (const expression of text.matchAll(/\$\{[\s\S]*?\}|<%=?[\s\S]*?%>/g)) {
        const expressionStart = expression.index ?? 0;
        for (const match of expression[0].matchAll(new RegExp(`\\b${escaped}\\b`, "g"))) {
            offsets.push({ start: expressionStart + (match.index ?? 0), length: name.length });
        }
    }
    return locationsFromOffsets(filePath, text, offsets);
}

function classEntry(project: GrailsProject, name: string): { filePath: string; artifact?: GrailsArtifact; source?: SourceClass } | null {
    const artifact = project.controllers.get(name) ?? project.services.get(name) ?? project.taglibs.get(name);
    if (artifact) return { filePath: artifact.filePath, artifact };
    const domain = project.domains.get(name);
    if (domain) return { filePath: domain.filePath };
    const source = project.sourceClassesBySimpleName.get(name)?.[0];
    return source ? { filePath: source.filePath, source } : null;
}

function hasAmbiguousClassName(project: GrailsProject, name: string): boolean {
    const candidates = project.sourceClassesBySimpleName.get(name) ?? [];
    return new Set(candidates.map((candidate) => path.resolve(candidate.filePath))).size > 1;
}

function logicalArtifactName(name: string): string {
    if (name.endsWith("Service")) return name.charAt(0).toLowerCase() + name.slice(1);
    const base = name.replace(/(?:Controller|TagLib)$/, "");
    return base.charAt(0).toLowerCase() + base.slice(1);
}

function injectedServiceName(name: string): string {
    return name.charAt(0).toLowerCase() + name.slice(1);
}

function viewTarget(document: TextDocument, params: TextDocumentPositionParams, project: GrailsProject): RenameTarget | null {
    const line = document.getText().split("\n")[params.position.line] ?? "";
    const value = /\b(?:view|template)\s*[:=]\s*['"]([^'"]+)['"]/.exec(line);
    if (!value || value.index == null) return null;
    const valueStart = value.index + value[0].indexOf(value[1]);
    const rawBase = path.posix.basename(value[1].replace(/\\/g, "/"));
    const stem = rawBase.replace(/\.gsp$/, "");
    const name = stem.replace(/^_/, "");
    const start = valueStart + value[1].lastIndexOf(rawBase) + (stem.startsWith("_") ? 1 : 0);
    const range = Range.create(params.position.line, start, params.position.line, start + name.length);
    if (params.position.character < start || params.position.character > start + name.length) return null;
    const definition = getDefinition(document, params, project);
    if (!definition || !uriToPath(definition.uri).endsWith(".gsp")) return null;
    return { kind: "view", name, range, definitionPath: uriToPath(definition.uri) };
}

function actionController(document: TextDocument, project: GrailsProject, line: string): GrailsArtifact | null {
    const explicit = /\bcontroller\s*[:=]\s*['"]([\w-]+)['"]/.exec(line)?.[1];
    if (explicit) {
        const name = `${explicit.charAt(0).toUpperCase()}${explicit.slice(1)}Controller`;
        return project.controllers.get(name) ?? null;
    }
    const filePath = uriToPath(document.uri);
    if (filePath.endsWith("Controller.groovy")) return project.controllers.get(path.basename(filePath, ".groovy")) ?? null;
    const relative = path.relative(path.join(project.root, "grails-app", "views"), filePath).replace(/\\/g, "/");
    const folder = relative.split("/")[0];
    if (!folder || folder === "layouts") return null;
    const name = `${folder.charAt(0).toUpperCase()}${folder.slice(1)}Controller`;
    return project.controllers.get(name) ?? null;
}

function resolveRenameTarget(document: TextDocument, params: TextDocumentPositionParams, project: GrailsProject): RenameTarget | null {
    const line = document.getText().split("\n")[params.position.line] ?? "";
    const packageDeclaration = /^\s*package\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/.exec(line);
    if (packageDeclaration?.index != null) {
        const start = packageDeclaration.index + packageDeclaration[0].indexOf(packageDeclaration[1]);
        const end = start + packageDeclaration[1].length;
        if (params.position.character >= start && params.position.character <= end) {
            return {
                kind: "package",
                name: packageDeclaration[1],
                range: Range.create(params.position.line, start, params.position.line, end),
                definitionPath: uriToPath(document.uri),
            };
        }
    }
    const identifier = identifierAt(document, params.position);
    if (!identifier) return null;
    const view = viewTarget(document, params, project);
    if (view) return view;
    const entry = classEntry(project, identifier.word);
    if (entry) return { kind: "class", name: identifier.word, range: identifier.range, definitionPath: entry.filePath };

    const actionValue = /\baction\s*[:=]\s*['"]([\w-]+)['"]/.exec(line);
    const actionDeclaration = new RegExp(`\\b(?:def|[A-Za-z_$][\\w.$<>?]*)\\s+${identifier.word}\\s*(?:\\(|=\\s*\\{)`).test(line);
    if ((actionValue?.[1] === identifier.word || actionDeclaration)) {
        const controller = actionController(document, project, line);
        if (controller) return { kind: "action", name: identifier.word, range: identifier.range, definitionPath: controller.filePath, controllerName: controller.name };
    }
    return null;
}

function packageReferences(project: GrailsProject, packageName: string): Location[] {
    const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return projectFiles(project).flatMap((file) =>
        findLocations(file, new RegExp(`^\\s*(?:package\\s+|import\\s+(?:static\\s+)?)(${escaped})(?=\\.|\\s|;|$)`, "m"), 1),
    );
}

function classReferences(project: GrailsProject, name: string): Location[] {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const entry = classEntry(project, name);
    const logical = logicalArtifactName(name);
    return projectFiles(project).flatMap((file) => {
        const locations = file.endsWith(".gsp")
            ? gspExpressionReferences(file, name)
            : findLocations(file, new RegExp(`\\b${escaped}\\b`));
        if (entry?.artifact?.kind === "controller") {
            locations.push(...findLocations(file, new RegExp(`\\bcontroller\\s*[:=]\\s*['"](${logical})['"]`), 1));
        } else if (entry?.artifact?.kind === "service") {
            const injectedName = injectedServiceName(name);
            locations.push(...(file.endsWith(".gsp")
                ? gspExpressionReferences(file, injectedName)
                : findLocations(file, new RegExp(`\\b(${injectedName})\\b`), 1)));
        }
        return locations;
    });
}

function actionReferences(project: GrailsProject, controllerName: string, action: string): Location[] {
    const logical = logicalArtifactName(controllerName);
    const controllerFile = project.controllers.get(controllerName)?.filePath;
    const viewRoot = path.join(project.root, "grails-app", "views", logical);
    const escaped = action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const locations: Location[] = [];
    for (const file of projectFiles(project)) {
        const normalized = file.replace(/\\/g, "/");
        const source = read(file);
        source.split("\n").forEach((line, lineNumber) => {
            const explicitController = /\bcontroller\s*[:=]\s*['"]([\w-]+)['"]/.exec(line)?.[1];
            const belongsToController = file === controllerFile || normalized.startsWith(viewRoot.replace(/\\/g, "/") + "/");
            if (explicitController && explicitController !== logical) return;
            if (!explicitController && !belongsToController) return;
            const pattern = file.endsWith(".gsp")
                ? new RegExp(`\\baction\\s*[:=]\\s*['"](${escaped})['"]`, "g")
                : new RegExp(`\\baction\\s*[:=]\\s*['"](${escaped})['"]|\\b(?:def\\s+)?(${escaped})\\s*(?:\\(|=\\s*\\{)`, "g");
            for (const match of line.matchAll(pattern)) {
                const value = match[1] ?? match[2];
                const offset = (match.index ?? 0) + match[0].indexOf(value);
                locations.push(Location.create(pathToUri(file), Range.create(lineNumber, offset, lineNumber, offset + value.length)));
            }
        });
    }
    return locations;
}

function viewReferences(project: GrailsProject, targetPath: string, logicalName: string): Location[] {
    const base = logicalName.replace(/^\//, "").replace(/^_/, "").replace(/\.gsp$/, "");
    const short = path.basename(base);
    const escaped = short.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return projectFiles(project).flatMap((file) =>
        findLocations(file, new RegExp(`\\b(?:view|template)\\s*[:=]\\s*['"](?:[^'"]*/)?(_?${escaped})(?:\\.gsp)?['"]`), 1),
    ).filter((location) => {
        const referencedDocument = TextDocument.create(location.uri, location.uri.endsWith(".gsp") ? "gsp" : "groovy", 1, read(uriToPath(location.uri)));
        const definition = getDefinition(referencedDocument, { textDocument: { uri: location.uri }, position: location.range.start }, project);
        return definition != null && path.resolve(uriToPath(definition.uri)) === path.resolve(targetPath);
    });
}

export function getReferences(document: TextDocument, params: TextDocumentPositionParams, project: GrailsProject | null, includeDeclaration = true): Location[] {
    if (!project) return [];
    const target = resolveRenameTarget(document, params, project);
    const identifier = identifierAt(document, params.position);
    if (!identifier) return [];
    let locations: Location[];
    if (target?.kind === "class") {
        if (hasAmbiguousClassName(project, target.name)) return [];
        locations = classReferences(project, target.name);
    }
    else if (target?.kind === "action" && target.controllerName) locations = actionReferences(project, target.controllerName, target.name);
    else if (target?.kind === "view") locations = viewReferences(project, target.definitionPath, target.name);
    else if (target?.kind === "package") locations = packageReferences(project, target.name);
    else {
        const escaped = identifier.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        locations = projectFiles(project).flatMap((file) => findLocations(file, new RegExp(`\\b${escaped}\\b`)));
    }
    const unique = new Map(locations.map((location) => [`${location.uri}:${location.range.start.line}:${location.range.start.character}`, location]));
    const result = [...unique.values()];
    if (includeDeclaration || !target) return result;
    const definitionLines = read(target.definitionPath).split("\n");
    const escaped = target.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const declarationLine = target.kind === "class"
        ? definitionLines.findIndex((line) => new RegExp(`\\b(?:class|interface|trait|enum|record)\\s+${escaped}\\b`).test(line))
        : target.kind === "action"
          ? definitionLines.findIndex((line) => new RegExp(`\\b(?:def|[A-Za-z_$][\\w.$<>?]*)\\s+${escaped}\\s*(?:\\(|=\\s*\\{)`).test(line))
          : target.kind === "package"
            ? definitionLines.findIndex((line) => new RegExp(`^\\s*package\\s+${escaped}(?:\\s|;|$)`).test(line))
            : -1;
    if (declarationLine < 0) return result;
    return result.filter(
        (location) =>
            path.resolve(uriToPath(location.uri)) !== path.resolve(target.definitionPath) ||
            location.range.start.line !== declarationLine,
    );
}

export function prepareRename(document: TextDocument, params: TextDocumentPositionParams, project: GrailsProject | null): { range: Range; placeholder: string } | null {
    if (!project) return null;
    const target = resolveRenameTarget(document, params, project);
    if (target?.kind === "class" && hasAmbiguousClassName(project, target.name)) return null;
    return target ? { range: target.range, placeholder: target.name } : null;
}

function replacementEdits(
    locations: Location[],
    newName: string,
    transform?: (current: string) => string,
): Map<string, TextEdit[]> {
    const edits = new Map<string, TextEdit[]>();
    for (const location of locations) {
        const values = edits.get(location.uri) ?? [];
        const line = read(uriToPath(location.uri)).split("\n")[location.range.start.line] ?? "";
        const current = line.slice(location.range.start.character, location.range.end.character);
        values.push(TextEdit.replace(location.range, transform?.(current) ?? newName));
        edits.set(location.uri, values);
    }
    return edits;
}

export function getRenameEdit(document: TextDocument, params: RenameParams, project: GrailsProject | null): WorkspaceEdit | null {
    if (!project) return null;
    const target = resolveRenameTarget(document, params, project);
    const validName = target?.kind === "package"
        ? /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(params.newName)
        : /^[A-Za-z_][\w-]*$/.test(params.newName);
    if (!target || !validName) return null;
    if (target.kind === "class" && hasAmbiguousClassName(project, target.name)) return null;

    let replacement = params.newName;
    let locations: Location[] = [];
    let newFilePath: string | null = null;
    if (target.kind === "class") {
        if ((target.name.endsWith("Controller") && !replacement.endsWith("Controller")) ||
            (target.name.endsWith("Service") && !replacement.endsWith("Service")) ||
            (target.name.endsWith("TagLib") && !replacement.endsWith("TagLib"))) return null;
        if (classEntry(project, replacement)) return null;
        locations = classReferences(project, target.name);
        const extension = path.extname(target.definitionPath);
        if (path.basename(target.definitionPath, extension) === target.name) newFilePath = path.join(path.dirname(target.definitionPath), replacement + extension);
    } else if (target.kind === "action" && target.controllerName) {
        locations = actionReferences(project, target.controllerName, target.name);
    } else if (target.kind === "view") {
        locations = viewReferences(project, target.definitionPath, target.name);
        const oldBase = path.basename(target.definitionPath, ".gsp");
        const prefix = oldBase.startsWith("_") ? "_" : "";
        replacement = params.newName.replace(/^_/, "");
        newFilePath = path.join(path.dirname(target.definitionPath), `${prefix}${replacement}.gsp`);
    } else if (target.kind === "package") {
        locations = packageReferences(project, target.name);
    }

    const oldLogicalName = logicalArtifactName(target.name);
    const newLogicalName = logicalArtifactName(replacement);
    const oldServiceName = target.name.endsWith("Service") ? injectedServiceName(target.name) : "";
    const newServiceName = replacement.endsWith("Service") ? injectedServiceName(replacement) : "";
    const edits = replacementEdits(
        locations,
        replacement,
        target.kind === "class"
            ? (current) => current === oldLogicalName
                ? newLogicalName
                : current === oldServiceName
                  ? newServiceName
                  : replacement
            : undefined,
    );
    const documentChanges: any[] = [...edits.entries()].map(([uri, textEdits]) => ({
        textDocument: { uri, version: null },
        edits: textEdits,
    }));
    if (newFilePath && path.resolve(newFilePath) !== path.resolve(target.definitionPath)) {
        if (fs.existsSync(newFilePath)) return null;
        documentChanges.push({ kind: "rename", oldUri: pathToUri(target.definitionPath), newUri: pathToUri(newFilePath) });
    }
    if (target.kind === "package") {
        const oldSegments = target.name.split(".");
        const newSegments = replacement.split(".");
        const renamed = new Set<string>();
        for (const sourceRoot of project.sourceRoots) {
            const oldDirectory = path.join(sourceRoot, ...oldSegments);
            const newDirectory = path.join(sourceRoot, ...newSegments);
            if (!fs.existsSync(oldDirectory)) continue;
            if (fs.existsSync(newDirectory)) return null;
            const key = path.resolve(oldDirectory);
            if (renamed.has(key)) continue;
            renamed.add(key);
            documentChanges.push({ kind: "rename", oldUri: pathToUri(oldDirectory), newUri: pathToUri(newDirectory) });
        }
    }
    return { documentChanges } as WorkspaceEdit;
}

function hierarchyItem(project: GrailsProject, filePath: string, name: string, line: number): CallHierarchyItem {
    const source = read(filePath).split("\n")[line] ?? "";
    const character = Math.max(0, source.indexOf(name));
    const range = Range.create(line, 0, line, source.length);
    return {
        name,
        kind: SymbolKind.Method,
        uri: pathToUri(filePath),
        range,
        selectionRange: Range.create(line, character, line, character + name.length),
        detail: path.relative(project.root, filePath).replace(/\\/g, "/"),
        data: { root: project.root, uri: pathToUri(filePath), name, line } satisfies HierarchyData,
    };
}

function declarationAt(document: TextDocument, position: Position): { name: string; line: number } | null {
    const identifier = identifierAt(document, position);
    if (!identifier) return null;
    const line = document.getText().split("\n")[position.line] ?? "";
    return new RegExp(`\\b(?:def|[A-Za-z_$][\\w.$<>?]*)\\s+${identifier.word}\\s*(?:\\(|=\\s*\\{)`).test(line)
        ? { name: identifier.word, line: position.line }
        : null;
}

export function prepareCallHierarchy(document: TextDocument, params: TextDocumentPositionParams, project: GrailsProject | null): CallHierarchyItem[] | null {
    if (!project || !uriToPath(document.uri).match(/\.(?:groovy|java)$/)) return null;
    const declaration = declarationAt(document, params.position);
    if (declaration) return [hierarchyItem(project, uriToPath(document.uri), declaration.name, declaration.line)];
    const identifier = identifierAt(document, params.position);
    const definition = getDefinition(document, params, project);
    if (!identifier || !definition) return null;
    return [hierarchyItem(project, uriToPath(definition.uri), identifier.word, definition.range.start.line)];
}

function enclosingMethod(project: GrailsProject, filePath: string, callLine: number): CallHierarchyItem | null {
    const lines = read(filePath).split("\n");
    for (let line = callLine; line >= 0; line--) {
        const match = /^\s*(?:def|[A-Za-z_$][\w.$<>?]*)\s+([A-Za-z_]\w*)\s*(?:\(|=\s*\{)/.exec(lines[line]);
        if (match) return hierarchyItem(project, filePath, match[1], line);
    }
    return null;
}

export function incomingCalls(item: CallHierarchyItem, project: GrailsProject | null): CallHierarchyIncomingCall[] {
    if (!project) return [];
    const data = item.data as HierarchyData | undefined;
    const name = data?.name ?? item.name;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const targetUri = data?.uri ?? item.uri;
    const targetLine = data?.line ?? item.selectionRange.start.line;
    const grouped = new Map<string, CallHierarchyIncomingCall>();
    for (const file of projectFiles(project)) {
        const source = read(file);
        const document = TextDocument.create(
            pathToUri(file),
            file.endsWith(".java") ? "java" : file.endsWith(".gsp") ? "gsp" : "groovy",
            1,
            source,
        );
        for (const location of findLocations(file, new RegExp(`\\b${escaped}\\s*(?=\\()`))) {
            if (location.uri === targetUri && location.range.start.line === targetLine) continue;
            const definition = getDefinition(document, {
                textDocument: { uri: document.uri },
                position: Position.create(location.range.start.line, location.range.start.character + 1),
            }, project);
            if (!definition || definition.uri !== targetUri || definition.range.start.line !== targetLine) continue;
            const caller = enclosingMethod(project, file, location.range.start.line);
            if (!caller) continue;
            const key = `${caller.uri}:${caller.selectionRange.start.line}`;
            const existingCall = grouped.get(key);
            if (existingCall) existingCall.fromRanges.push(location.range);
            else grouped.set(key, { from: caller, fromRanges: [location.range] });
        }
    }
    return [...grouped.values()];
}

function methodBody(filePath: string, startLine: number): { text: string; startLine: number } {
    const lines = read(filePath).split("\n");
    let depth = 0;
    let started = false;
    const selected: string[] = [];
    for (let line = startLine; line < lines.length; line++) {
        selected.push(lines[line]);
        for (const char of lines[line]) {
            if (char === "{") { depth++; started = true; }
            else if (char === "}") depth--;
        }
        if (started && depth <= 0) break;
    }
    return { text: selected.join("\n"), startLine };
}

export function outgoingCalls(item: CallHierarchyItem, project: GrailsProject | null): CallHierarchyOutgoingCall[] {
    if (!project) return [];
    const data = item.data as HierarchyData | undefined;
    const filePath = uriToPath(data?.uri ?? item.uri);
    const body = methodBody(filePath, data?.line ?? item.range.start.line);
    const document = TextDocument.create(pathToUri(filePath), filePath.endsWith(".java") ? "java" : "groovy", 1, read(filePath));
    const grouped = new Map<string, CallHierarchyOutgoingCall>();
    body.text.split("\n").forEach((line, offset) => {
        for (const match of line.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
            if (["if", "for", "while", "switch", "catch", "return", item.name].includes(match[1])) continue;
            const lineNumber = body.startLine + offset;
            const character = (match.index ?? 0) + 1;
            const definition = getDefinition(document, { textDocument: { uri: document.uri }, position: { line: lineNumber, character } }, project);
            if (!definition) continue;
            const target = hierarchyItem(project, uriToPath(definition.uri), match[1], definition.range.start.line);
            const key = `${target.uri}:${target.selectionRange.start.line}:${target.name}`;
            const fromRange = Range.create(lineNumber, match.index ?? 0, lineNumber, (match.index ?? 0) + match[1].length);
            const existingCall = grouped.get(key);
            if (existingCall) existingCall.fromRanges.push(fromRange);
            else grouped.set(key, { to: target, fromRanges: [fromRange] });
        }
    });
    return [...grouped.values()];
}

export function getCodeLenses(document: TextDocument, project: GrailsProject | null): CodeLens[] {
    if (!project) return [];
    const filePath = uriToPath(document.uri);
    const source = document.getText();
    const lenses: CodeLens[] = [];
    if (filePath.endsWith(".gsp")) {
        const relative = path.relative(path.join(project.root, "grails-app", "views"), filePath).replace(/\\/g, "/");
        const folder = relative.split("/")[0];
        if (folder && folder !== "layouts") {
            const controllerName = `${folder.charAt(0).toUpperCase()}${folder.slice(1)}Controller`;
            const controller = project.controllers.get(controllerName);
            if (controller) {
                lenses.push({
                    range: Range.create(0, 0, 0, 0),
                    command: {
                        title: `$(symbol-class) ${controllerName}`,
                        command: "grails.openLocation",
                        arguments: [pathToUri(controller.filePath), { line: 0, character: 0 }],
                    },
                });
            }
        }
        return lenses;
    }
    const classDeclaration = /\bclass\s+([A-Za-z_]\w*)/.exec(source);
    const className = classDeclaration?.[1];
    if (className && classDeclaration && classEntry(project, className)) {
        const declarationOffset = (classDeclaration.index ?? 0) + classDeclaration[0].indexOf(className);
        const line = source.slice(0, declarationOffset).split("\n").length - 1;
        const refs = classReferences(project, className).filter((location) => location.uri !== document.uri || location.range.start.line !== line);
        lenses.push({
            range: Range.create(line, 0, line, 0),
            command: { title: `${refs.length} referencia${refs.length === 1 ? "" : "s"}`, command: "grails.showReferences", arguments: [document.uri, { line, character: 0 }, refs] },
        });
    }
    if (filePath.endsWith("Controller.groovy")) {
        const controllerName = path.basename(filePath, ".groovy");
        source.split("\n").forEach((lineText, line) => {
            const action = /^\s*(?:def|[A-Za-z_$][\w.$<>?]*)\s+([A-Za-z_]\w*)\s*(?:\(|=\s*\{)/.exec(lineText)?.[1];
            if (!action || action === controllerName) return;
            const refs = actionReferences(project, controllerName, action);
            lenses.push({ range: Range.create(line, 0, line, 0), command: { title: `${refs.length} uso${refs.length === 1 ? "" : "s"} de la acción`, command: "grails.showReferences", arguments: [document.uri, { line, character: lineText.indexOf(action) }, refs] } });
        });
    }
    return lenses;
}
