import * as fs from "fs";
import * as path from "path";
import {
    CompletionItem,
    CompletionItemKind,
    MarkupKind,
    TextDocumentPositionParams,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
    GrailsProject,
    DomainClass,
    GrailsArtifact,
    inferDomainFromController,
} from "./grailsProject";
import { uriToPath } from "./uriUtils";
import { getGspCompletions } from "./gspFeatures";
import { getGormDslCompletions } from "./gormFeatures";

// ─── Context detection ────────────────────────────────────────────────────────

type CompletionKind =
    | "import" // import com.example.|
    | "domain_name" // def x = Fus|  or  Fusion.  (unresolved yet)
    | "gorm_static" // Book.|  or  pkg.Book.|
    | "gorm_static_and" // Book.findByTitle|  — cursor after a findBy, add AndProp
    | "gorm_instance" // book.|
    | "service_injection" // bookService.|
    | "controller_static" // SwaggerController.|
    | "source_members" // ProjectGroovyOrJavaClass.| or typedVariable.|
    | "string_controller" // controller: "b|"  or  controller: '|'
    | "string_action" // action: "lo|"  — needs controller context
    | "string_view" // view: "/lay|"  or  view: "sh|"
    | "render_redirect_key" // render(|  or  redirect(|  — named arg keys
    | "artifact_name" // SwaggerController|  TestService|  (bare word, no dot yet)
    | "generic_grails";

interface CompletionContext {
    kind: CompletionKind;
    domainName?: string;
    instanceName?: string;
    // For string_action: which controller to look in
    targetController?: string;
    // For string_view: partial path typed so far
    viewPrefix?: string;
    // For import: column where the package path starts (after "import ")
    importStartCol?: number;
    // For gorm_static_and: the method typed so far (e.g. "findByTitleAnd")
    finderPrefix?: string;
    // For domain_name: set of imported class names in the current file
    importedNames?: Set<string>;
    // For controller_static: the controller class name
    controllerName?: string;
    sourceName?: string;
    // For artifact_name: the typed prefix
    artifactPrefix?: string;
}

function getLineUpToCursor(
    doc: TextDocument,
    params: TextDocumentPositionParams,
): string {
    const lines = doc.getText().split("\n");
    const line = lines[params.position.line] ?? "";
    return line.slice(0, params.position.character);
}

/** Find the nearest controller: "value" on the same line or on a nearby line above */
function resolveControllerFromContext(
    doc: TextDocument,
    cursorLine: number,
    project: GrailsProject,
): GrailsArtifact | null {
    const lines = doc.getText().split("\n");
    // Search on the same line first, then up to 3 lines above (multi-line redirect)
    for (let i = cursorLine; i >= Math.max(0, cursorLine - 3); i--) {
        const l = lines[i];
        const ctrlMatch = /controller\s*:\s*['"](\w+)['"]/.exec(l);
        if (ctrlMatch) {
            const name = ctrlMatch[1];
            const capitalized =
                name.charAt(0).toUpperCase() + name.slice(1) + "Controller";
            return project.controllers.get(capitalized) ?? null;
        }
    }
    return null;
}

/**
 * Parses all imported class names from the document text.
 * Returns a Set of simple class names: "import util.Fusion" → "Fusion"
 * Also includes "*" wildcard imports: "import usuarios.*" → adds all domains
 * from the "usuarios" package.
 */
function parseImportedNames(
    docText: string,
    project: GrailsProject | null,
): Set<string> {
    const imported = new Set<string>();
    const lines = docText.split("\n");

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("import ")) continue;

        // Wildcard: import usuarios.*  or  import util.*
        const wildcardMatch = /^import\s+([\w.]+)\.\*/.exec(trimmed);
        if (wildcardMatch && project) {
            const pkg = wildcardMatch[1]; // e.g. "usuarios"
            // Add all domains/controllers/services whose package matches
            for (const [name, domain] of project.domains) {
                const rel = domain.filePath.replace(/\\/g, "/");
                // Package is inferred from path: grails-app/domain/usuarios/Foo.groovy → "usuarios"
                if (
                    rel.includes(`/${pkg}/`) ||
                    rel.endsWith(`/${pkg}.groovy`)
                ) {
                    imported.add(name);
                }
            }
            continue;
        }

        // Named import: import util.Fusion  or  import com.example.Book
        const namedMatch = /^import\s+[\w.]+\.([A-Z]\w+)$/.exec(trimmed);
        if (namedMatch) {
            imported.add(namedMatch[1]);
        }
    }

    return imported;
}

function documentPackage(docText: string): string {
    return /^\s*package\s+([\w.]+)/m.exec(docText)?.[1] ?? "";
}

function isDomainAccessible(
    domain: DomainClass,
    doc: TextDocument,
    hasQualifiedPrefix: boolean,
    importedNames: Set<string>,
): boolean {
    if (hasQualifiedPrefix || importedNames.has(domain.name)) return true;
    if (documentPackage(doc.getText()) === domain.packageName) return true;
    return path.resolve(uriToPath(doc.uri)) === path.resolve(domain.filePath);
}

function resolveDomainNameForVariable(
    variableName: string,
    docText: string,
    project: GrailsProject,
): string | null {
    const escaped = variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
        new RegExp(`\\b([A-Z]\\w*)\\s+${escaped}\\b`),
        new RegExp(`\\b(?:def|var)\\s+${escaped}\\s*=\\s*new\\s+([A-Z]\\w*)\\b`),
        new RegExp(`\\b(?:def|var)\\s+${escaped}\\s*=\\s*([A-Z]\\w*)\\s*\\??\\.(?:get|read|load|find|findBy|findAll|findAllBy|where|list)\\w*`),
    ];
    for (const pattern of patterns) {
        const match = pattern.exec(docText);
        if (match && project.domains.has(match[1])) return match[1];
    }
    return null;
}

function resolveSourceNameForVariable(
    variableName: string,
    docText: string,
    project: GrailsProject,
): string | null {
    const escaped = variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
        new RegExp(`\\b([A-Z]\\w*)\\s+${escaped}\\b`),
        new RegExp(`\\b(?:def|var)\\s+${escaped}\\s*=\\s*new\\s+([A-Z]\\w*)\\b`),
        new RegExp(`\\b(?:def|var)\\s+${escaped}\\s*=\\s*([A-Z]\\w*)\\s*[.(]`),
    ];
    for (const pattern of patterns) {
        const match = pattern.exec(docText);
        if (match && project.sourceClassesBySimpleName.has(match[1]))
            return match[1];
    }
    return null;
}

function detectContext(
    doc: TextDocument,
    params: TextDocumentPositionParams,
    project: GrailsProject | null,
): CompletionContext {
    const lineUpTo = getLineUpToCursor(doc, params);
    const filePath = uriToPath(doc.uri);
    const cursorLine = params.position.line;

    // ── import ───────────────────────────────────────────────────────────────
    const importMatch = /^(\s*import\s+)([\w.]*)$/.exec(lineUpTo);
    if (importMatch) {
        const importStartCol = importMatch[1].length; // column where package path begins
        return { kind: "import", instanceName: importMatch[2], importStartCol };
    }

    // ── string_controller: controller: "b|" or controller: 'b|' ─────────────
    if (/controller\s*:\s*['"][^'"]*$/.test(lineUpTo)) {
        return { kind: "string_controller" };
    }

    // ── string_action: action: "lo|" ─────────────────────────────────────────
    if (/action\s*:\s*['"][^'"]*$/.test(lineUpTo)) {
        const targetArtifact = project
            ? resolveControllerFromContext(doc, cursorLine, project)
            : null;
        // If no explicit controller: found, use current file
        const targetController = targetArtifact
            ? targetArtifact.name
            : path.basename(filePath, ".groovy");
        return { kind: "string_action", targetController };
    }

    // ── string_view: view: "/lay|" or view: "sh|" ───────────────────────────
    if (/view\s*:\s*['"][^'"]*$/.test(lineUpTo)) {
        const viewPrefixMatch = /view\s*:\s*['"]([^'"]*)$/.exec(lineUpTo);
        return { kind: "string_view", viewPrefix: viewPrefixMatch?.[1] ?? "" };
    }

    // ── render/redirect named-arg keys (before the colon) ────────────────────
    if (/\b(render|redirect)\s*\([^)]*$/.test(lineUpTo)) {
        return { kind: "render_redirect_key" };
    }

    // ── Package-qualified or bare domain: util.Fusion.| or util.Fusion.findBy|
    // Also handles ControllerName.| and ServiceName.| (class-level references)
    const pkgDomainMatch = /(?:[\w]+\.)*([A-Z]\w+)\.(\w*)$/.exec(lineUpTo);
    if (pkgDomainMatch) {
        const candidate = pkgDomainMatch[1];
        const candidateStart = pkgDomainMatch.index + pkgDomainMatch[0].lastIndexOf(candidate);
        const embeddedCamelCase = candidateStart > 0 && /[a-z]/.test(lineUpTo[candidateStart - 1]);

        // 1. Domain class check (requires import)
        const domain = project?.domains.get(candidate);
        if (domain && !embeddedCamelCase) {
            const fullMatch = pkgDomainMatch[0];
            const hasPkgPrefix =
                fullMatch.indexOf(".") !== fullMatch.lastIndexOf(".");
            const importedNamesLocal = parseImportedNames(
                doc.getText(),
                project,
            );
            const isImported = isDomainAccessible(
                domain,
                doc,
                hasPkgPrefix,
                importedNamesLocal,
            );
            if (isImported) {
                const finderSoFar = pkgDomainMatch[2];
                if (
                    /^(?:find(?:All)?By|listBy|countBy|existsBy)\w+(And|Or)\w*$/.test(
                        finderSoFar,
                    ) ||
                    /^(?:find(?:All)?By|listBy|countBy|existsBy)\w+And\w*$/.test(
                        finderSoFar,
                    )
                ) {
                    return {
                        kind: "gorm_static_and",
                        domainName: candidate,
                        finderPrefix: finderSoFar,
                    };
                }
                return {
                    kind: "gorm_static",
                    domainName: candidate,
                    finderPrefix: finderSoFar || undefined,
                };
            }
        }

        // 2. Controller class check (SwaggerController. — no import required)
        if (!embeddedCamelCase && project?.controllers.has(candidate)) {
            return { kind: "controller_static", controllerName: candidate };
        }

        // 3. Service class check — only when candidate looks like a full class name
        // (not a camelCase fragment like "TokenService" from "fusionTokenService.")
        // Heuristic: the character before the candidate in lineUpTo must be a space,
        // = sign, ( or start of line — NOT a lowercase letter (which would be camelCase split)
        if (!embeddedCamelCase && project?.services.has(candidate)) {
            const beforeCandidate = lineUpTo.slice(
                0,
                pkgDomainMatch.index +
                    pkgDomainMatch[0].length -
                    pkgDomainMatch[1].length -
                    pkgDomainMatch[2].length -
                    1,
            );
            const lastChar = beforeCandidate.slice(-1);
            const isCamelCaseSplit = /[a-z]/.test(lastChar);
            if (!isCamelCaseSplit) {
                return { kind: "service_injection", instanceName: candidate };
            }
        }

        if (!embeddedCamelCase && project?.sourceClassesBySimpleName.has(candidate)) {
            return { kind: "source_members", sourceName: candidate };
        }
    }
    // ── GORM static: Book.| (simple, no package prefix) ─────────────────────
    const staticMatch = /([A-Z]\w+)\.(\w*)$/.exec(lineUpTo);
    const staticEmbeddedCamelCase = staticMatch != null && staticMatch.index > 0 && /[a-z]/.test(lineUpTo[staticMatch.index - 1]);
    if (staticMatch && !staticEmbeddedCamelCase && project?.domains.has(staticMatch[1])) {
        const importedNamesStatic = parseImportedNames(doc.getText(), project);
        const domain = project.domains.get(staticMatch[1])!;
        if (isDomainAccessible(domain, doc, false, importedNamesStatic)) {
            const finderSoFar = staticMatch[2];
            if (
                /^(?:find(?:All)?By|listBy|countBy|existsBy)\w+(And|Or)\w*$/.test(
                    finderSoFar,
                ) ||
                /^(?:find(?:All)?By|listBy|countBy|existsBy)\w+And\w*$/.test(
                    finderSoFar,
                )
            ) {
                return {
                    kind: "gorm_static_and",
                    domainName: staticMatch[1],
                    finderPrefix: finderSoFar,
                };
            }
            return {
                kind: "gorm_static",
                domainName: staticMatch[1],
                finderPrefix: finderSoFar || undefined,
            };
        }
    }

    // ── Domain / Controller / Service bare word: Fus|  SwaggerController|  BookService| ─
    // Suggests class names when user types a capitalized word after =, (, [, etc.
    // but NOT after a dot (already handled above).
    const bareWordMatch = /(?:=\s*|[\(\[,]\s*|^\s*)([A-Z]\w*)$/.exec(lineUpTo);
    if (bareWordMatch && project && !lineUpTo.trimEnd().endsWith(".")) {
        const typed = bareWordMatch[1];
        if (typed.length >= 1) {
            const lowerTyped = typed.toLowerCase();
            const importedNames = parseImportedNames(doc.getText(), project);
            const accessibleNames = new Set(importedNames);
            for (const domain of project.domains.values()) {
                if (isDomainAccessible(domain, doc, false, importedNames)) accessibleNames.add(domain.name);
            }

            const hasDomainMatch = [...project.domains.keys()].some(
                (d) => d.toLowerCase().startsWith(lowerTyped) && accessibleNames.has(d),
            );
            if (hasDomainMatch) {
                return {
                    kind: "domain_name",
                    instanceName: typed,
                    importedNames: accessibleNames,
                };
            }

            // Controllers and services: no import required for class-level reference
            const hasControllerMatch = [...project.controllers.keys()].some(
                (c) => c.toLowerCase().startsWith(lowerTyped),
            );
            const hasServiceMatch = [...project.services.keys()].some((s) =>
                s.toLowerCase().startsWith(lowerTyped),
            );
            const hasSourceMatch = [
                ...project.sourceClassesBySimpleName.keys(),
            ].some((sourceName) =>
                sourceName.toLowerCase().startsWith(lowerTyped),
            );
            if (hasControllerMatch || hasServiceMatch || hasSourceMatch) {
                return { kind: "artifact_name", artifactPrefix: typed };
            }
        }
    }
    // ── service instance: bookService.| ──────────────────────────────────────
    const serviceMatch = /(\w+Service)\??\.(\w*)$/.exec(lineUpTo);
    if (serviceMatch && project) {
        return { kind: "service_injection", instanceName: serviceMatch[1] };
    }

    // ── GORM instance: book.| ─────────────────────────────────────────────────
    const instanceMatch = /([a-z]\w*)\??\.(\w*)$/.exec(lineUpTo);
    if (instanceMatch && project) {
        const varName = instanceMatch[1];
        const domainName = [...project.domains.keys()].find(
            (d) => d.toLowerCase() === varName.toLowerCase(),
        ) ?? resolveDomainNameForVariable(varName, doc.getText(), project);
        if (domainName) {
            return { kind: "gorm_instance", domainName, instanceName: varName };
        }
        const sourceName = resolveSourceNameForVariable(
            varName,
            doc.getText(),
            project,
        );
        if (sourceName) return { kind: "source_members", sourceName };
    }

    return { kind: "generic_grails" };
}

// ─── Completion builders ──────────────────────────────────────────────────────

// ── import completions ────────────────────────────────────────────────────────

function importCompletions(
    project: GrailsProject,
    typedPrefix: string,
    line: number,
    importStartCol: number,
    cursorCol: number,
): CompletionItem[] {
    const items: CompletionItem[] = [];

    const allPaths: Array<{
        packagePath: string;
        kind: CompletionItemKind;
        detail: string;
    }> = [];

    for (const [name, domain] of project.domains) {
        const rel = path.relative(
            path.join(project.root, "grails-app/domain"),
            domain.filePath,
        );
        const packagePath = rel.replace(/\.groovy$/, "").replace(/[/\\]/g, ".");
        allPaths.push({
            packagePath,
            kind: CompletionItemKind.Class,
            detail: `Domain: ${name}`,
        });
    }
    for (const [name, ctrl] of project.controllers) {
        const rel = path.relative(
            path.join(project.root, "grails-app/controllers"),
            ctrl.filePath,
        );
        const packagePath = rel.replace(/\.groovy$/, "").replace(/[/\\]/g, ".");
        allPaths.push({
            packagePath,
            kind: CompletionItemKind.Class,
            detail: `Controller: ${name}`,
        });
    }
    for (const [name, svc] of project.services) {
        const rel = path.relative(
            path.join(project.root, "grails-app/services"),
            svc.filePath,
        );
        const packagePath = rel.replace(/\.groovy$/, "").replace(/[/\\]/g, ".");
        allPaths.push({
            packagePath,
            kind: CompletionItemKind.Class,
            detail: `Service: ${name}`,
        });
    }


    const existing = new Set(allPaths.map((entry) => entry.packagePath));
    for (const sourceClass of project.sourceClasses.values()) {
        if (existing.has(sourceClass.qualifiedName)) continue;
        allPaths.push({
            packagePath: sourceClass.qualifiedName,
            kind:
                sourceClass.declarationKind === "interface"
                    ? CompletionItemKind.Interface
                    : sourceClass.declarationKind === "enum"
                      ? CompletionItemKind.Enum
                      : CompletionItemKind.Class,
            detail: `${sourceClass.language} ${sourceClass.declarationKind}: ${sourceClass.name}`,
        });
    }

    for (const { packagePath, kind, detail } of allPaths) {
        // Filter: package must contain the typed text anywhere (fuzzy-friendly)
        // or start with the typed prefix (exact prefix match)
        const lowerPackage = packagePath.toLowerCase();
        const lowerPrefix = typedPrefix.toLowerCase();
        if (typedPrefix.length > 0 && !lowerPackage.includes(lowerPrefix))
            continue;

        items.push({
            label: packagePath,
            filterText: packagePath,
            kind,
            detail,
            // textEdit replaces everything from importStartCol to cursor with the full package path
            // This avoids any duplication regardless of what VS Code considers the "word"
            textEdit: {
                range: {
                    start: { line, character: importStartCol },
                    end: { line, character: cursorCol },
                },
                newText: packagePath,
            },
        });
    }

    return items;
}

function sourceMemberCompletions(
    sourceName: string,
    project: GrailsProject,
): CompletionItem[] {
    const candidates = project.sourceClassesBySimpleName.get(sourceName) ?? [];
    const seen = new Set<string>();
    const items: CompletionItem[] = [];
    for (const candidate of candidates) {
        for (const member of candidate.members) {
            const key = `${member.kind}:${member.name}`;
            if (seen.has(key)) continue;
            seen.add(key);
            items.push({
                label: member.name,
                kind:
                    member.kind === "method"
                        ? CompletionItemKind.Method
                        : CompletionItemKind.Property,
                detail: `${candidate.qualifiedName} — ${member.kind}`,
                insertText:
                    member.kind === "method"
                        ? `${member.name}($1)`
                        : member.name,
                insertTextFormat: member.kind === "method" ? 2 : 1,
            });
        }
    }
    return items;
}

// ── controller name completions ───────────────────────────────────────────────

function controllerNameCompletions(project: GrailsProject): CompletionItem[] {
    return [...project.controllers.values()].map((ctrl) => ({
        label: ctrl.simpleName,
        kind: CompletionItemKind.Class,
        detail: ctrl.name,
        insertText: ctrl.simpleName,
    }));
}

// ── action name completions ───────────────────────────────────────────────────

function actionNameCompletions(
    targetControllerName: string,
    project: GrailsProject,
    currentFilePath: string,
): CompletionItem[] {
    // Resolve target file: explicit controller or current file
    let filePath: string | null = null;

    const artifact = project.controllers.get(targetControllerName);
    if (artifact) {
        filePath = artifact.filePath;
    } else {
        // targetControllerName is already the bare filename (current file)
        filePath = currentFilePath;
    }

    if (!filePath) return [];

    const src = (() => {
        try {
            return fs.readFileSync(filePath, "utf8");
        } catch {
            return null;
        }
    })();
    if (!src) return [];

    // Find all "def actionName" declarations
    const actionRe = /^\s*def\s+(\w+)\s*(?:\(|=\s*\{)/gm;
    const items: CompletionItem[] = [];
    let m: RegExpExecArray | null;
    while ((m = actionRe.exec(src)) !== null) {
        items.push({
            label: m[1],
            kind: CompletionItemKind.Method,
            detail: `action in ${path.basename(filePath, ".groovy")}`,
            insertText: m[1],
        });
    }
    return items;
}

// ── view path completions ─────────────────────────────────────────────────────

function viewPathCompletions(
    viewPrefix: string,
    project: GrailsProject,
    currentFilePath: string,
): CompletionItem[] {
    const viewsRoot = path.join(project.root, "grails-app/views");
    if (!fs.existsSync(viewsRoot)) return [];

    const items: CompletionItem[] = [];
    const isAbsolute = viewPrefix.startsWith("/");

    if (isAbsolute) {
        // Absolute path from views root: "/layouts/main" or "/layouts/" or "/"
        const partial = viewPrefix.slice(1); // strip leading /

        // Determine the directory to list and the filename prefix to filter
        let searchIn: string;
        let filePrefix: string;

        if (partial.endsWith("/") || partial === "") {
            // User typed "/" or "/layouts/" — list contents of that directory
            searchIn =
                partial === ""
                    ? viewsRoot
                    : path.join(viewsRoot, partial.slice(0, -1));
            filePrefix = "";
        } else {
            // User typed "/lay" or "/layouts/ma" — split into dir + prefix
            const lastSlash = partial.lastIndexOf("/");
            if (lastSlash === -1) {
                searchIn = viewsRoot;
                filePrefix = partial.toLowerCase();
            } else {
                searchIn = path.join(viewsRoot, partial.slice(0, lastSlash));
                filePrefix = partial.slice(lastSlash + 1).toLowerCase();
            }
        }

        if (fs.existsSync(searchIn)) {
            for (const entry of fs.readdirSync(searchIn, {
                withFileTypes: true,
            })) {
                if (!entry.name.toLowerCase().startsWith(filePrefix)) continue;
                if (entry.isDirectory()) {
                    items.push({
                        label: entry.name,
                        kind: CompletionItemKind.Folder,
                        detail: "views subdirectory",
                        insertText: entry.name,
                    });
                } else if (entry.name.endsWith(".gsp")) {
                    const logical = entry.name
                        .replace(/^_/, "")
                        .replace(/\.gsp$/, "");
                    items.push({
                        label: logical,
                        kind: CompletionItemKind.File,
                        detail: entry.name,
                        insertText: logical,
                    });
                }
            }
        }
    } else {
        // Relative: look in current controller's views folder
        const ctrlName = path
            .basename(currentFilePath, ".groovy")
            .replace(/Controller$/, "")
            .toLowerCase();
        const ctrlViewsDir = path.join(viewsRoot, ctrlName);
        const prefix = viewPrefix.toLowerCase();

        if (fs.existsSync(ctrlViewsDir)) {
            for (const entry of fs.readdirSync(ctrlViewsDir, {
                withFileTypes: true,
            })) {
                if (!entry.name.endsWith(".gsp")) continue;
                const logical = entry.name
                    .replace(/^_/, "")
                    .replace(/\.gsp$/, "");
                if (!logical.toLowerCase().startsWith(prefix)) continue;
                items.push({
                    label: logical,
                    kind: CompletionItemKind.File,
                    detail: entry.name,
                    insertText: logical,
                });
            }
        }
    }

    return items;
}

// ── Domain name completions (bare word: def x = Fus|) ───────────────────────

/**
 * Suggests domain class names when the user types a capitalized prefix
 * without a dot yet — e.g. "def x = Fus" → suggests "Fusion", "FusionType"…
 * Includes a snippet that inserts "ClassName." so they can continue typing.
 */
function domainNameCompletions(
    typedPrefix: string,
    project: GrailsProject,
    importedNames?: Set<string>,
): CompletionItem[] {
    const lowerTyped = typedPrefix.toLowerCase();
    return [...project.domains.values()]
        .filter(
            (d) =>
                d.name.toLowerCase().startsWith(lowerTyped) &&
                importedNames != null &&
                importedNames.has(d.name),
        )
        .map(
            (d) =>
                ({
                    label: d.name,
                    kind: CompletionItemKind.Class,
                    detail: `Domain class — ${d.properties.length} properties`,
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: [
                            `**${d.name}** domain class`,
                            d.properties.length > 0
                                ? `\nProperties: ${d.properties
                                      .slice(0, 5)
                                      .map((p) => `\`${p.type} ${p.name}\``)
                                      .join(
                                          ", ",
                                      )}${d.properties.length > 5 ? "…" : ""}`
                                : "",
                        ].join(""),
                    },
                    insertText: d.name,
                }) as CompletionItem,
        );
}

// ── GORM And/Or chaining completions ─────────────────────────────────────────

/**
 * When the user has typed e.g. "Fusion.findByDescripcionAnd" we offer all
 * remaining properties as the next And/Or segment.
 *
 * Example:
 *   Fusion.findByDescripcionAnd|  →  AndAutorizacion, AndUrl, AndActivo …
 *   Fusion.findAllByTipoOrActivo|  →  OrDescripcion, OrUrl …
 *
 * The connector (And/Or) is determined from what the user last typed.
 */
function gormStaticAndCompletions(
    finderPrefix: string,
    domain: DomainClass,
): CompletionItem[] {
    // Extract all properties already in the chain using two-pass approach:
    // Pass 1: first property after findBy/findAllBy
    // Pass 2: each property after And/Or connectors
    // Old single-regex approach missed props after the first because "By" only appears once.
    const usedProps = new Set<string>();

    const firstPropMatch = /^find(?:All)?By([A-Z]\w+?)(?=And|Or|$)/.exec(
        finderPrefix,
    );
    if (firstPropMatch) usedProps.add(firstPropMatch[1].toLowerCase());

    const segmentRe = /(?:And|Or)([A-Z]\w+?)(?=And|Or|$)/g;
    let m: RegExpExecArray | null;
    while ((m = segmentRe.exec(finderPrefix)) !== null) {
        usedProps.add(m[1].toLowerCase());
    }

    // Compute the base: everything up to and including the last "And"/"Or"
    // e.g. "findByNombreAnd" from "findByNombreAndP"
    const baseMatch = /^(.*(?:And|Or))\w*$/.exec(finderPrefix);
    // When no And/Or yet (first chaining), base is the full finderPrefix
    const base = baseMatch ? baseMatch[1] : finderPrefix;

    // paramCount = one param per property already in the chain
    const paramCount = usedProps.size;

    const items: CompletionItem[] = [];

    for (const prop of domain.properties) {
        if (usedProps.has(prop.name.toLowerCase())) continue;
        const propCap = prop.name.charAt(0).toUpperCase() + prop.name.slice(1);

        // Build full finder name for filterText and insertText
        // VS Code sees "findByNombreAndP" as ONE word (all \w chars)
        // So filterText must be the full word, and insertText must replace it entirely
        const andFullName = `${base}${propCap}`;
        const orBase = base.replace(/(And|Or)$/, "Or");
        const orFullName = `${orBase}${propCap}`;

        // Build snippet params: ($1, $2) for 2 props, ($1, $2, $3) for 3, etc.
        const params = Array.from(
            { length: paramCount + 1 },
            (_, k) => `$${k + 1}`,
        ).join(", ");

        items.push({
            label: `And${propCap}`,
            filterText: andFullName,
            kind: CompletionItemKind.Method,
            detail: `And: ${prop.type} ${prop.name}`,
            insertText: `${andFullName}(${params})`,
            insertTextFormat: 2,
        });

        items.push({
            label: `Or${propCap}`,
            filterText: orFullName,
            kind: CompletionItemKind.Method,
            detail: `Or: ${prop.type} ${prop.name}`,
            insertText: `${orFullName}(${params})`,
            insertTextFormat: 2,
        });
    }

    return items;
}

// ── GORM static completions ───────────────────────────────────────────────────

function gormStaticCompletions(domain: DomainClass): CompletionItem[] {
    const d = domain.name;
    const props = domain.properties;

    // Single-property finders
    const findByItems: CompletionItem[] = props.map((p) => ({
        label: `findBy${capitalize(p.name)}`,
        kind: CompletionItemKind.Method,
        detail: `${d} — single finder`,
        documentation: {
            kind: MarkupKind.Markdown,
            value: `Finds the first \`${d}\` where \`${p.name}\` matches.`,
        },
        insertText: `findBy${capitalize(p.name)}($1)`,
        insertTextFormat: 2,
    }));

    const findAllByItems: CompletionItem[] = props.map((p) => ({
        label: `findAllBy${capitalize(p.name)}`,
        kind: CompletionItemKind.Method,
        detail: `${d} — list finder`,
        insertText: `findAllBy${capitalize(p.name)}($1)`,
        insertTextFormat: 2,
    }));

    const dynamicFinderItems: CompletionItem[] = props.flatMap((p) => {
        const property = capitalize(p.name);
        const operators = [
            ["LessThan", "$1"], ["LessThanEquals", "$1"],
            ["GreaterThan", "$1"], ["GreaterThanEquals", "$1"],
            ["Between", "$1, $2"], ["Like", "'$1'"], ["Ilike", "'$1'"],
            ["IsNull", ""], ["IsNotNull", ""], ["Not", "$1"],
            ["NotEqual", "$1"], ["InList", "$1"],
        ];
        const variants: CompletionItem[] = [];
        for (const prefix of ["findBy", "findAllBy", "countBy"]) {
            variants.push({
                label: `${prefix}${property}`,
                kind: CompletionItemKind.Method,
                detail: `${d} dynamic finder for ${p.name}`,
                insertText: `${prefix}${property}($1)`,
                insertTextFormat: 2,
            });
            for (const [operator, args] of operators) {
                variants.push({
                    label: `${prefix}${property}${operator}`,
                    kind: CompletionItemKind.Method,
                    detail: `${d} dynamic finder — ${p.name} ${operator}`,
                    insertText: `${prefix}${property}${operator}(${args})`,
                    insertTextFormat: 2,
                });
            }
        }
        for (const prefix of ["findOrCreateBy", "findOrSaveBy"]) {
            variants.push({
                label: `${prefix}${property}`,
                kind: CompletionItemKind.Method,
                detail: `${d} dynamic persistence finder for ${p.name}`,
                insertText: `${prefix}${property}($1)`,
                insertTextFormat: 2,
            });
        }
        variants.push({
            label: `listOrderBy${property}`,
            kind: CompletionItemKind.Method,
            detail: `${d} list ordered by ${p.name}`,
            insertText: `listOrderBy${property}(\${1:[order: 'asc']})`,
            insertTextFormat: 2,
        });
        return variants;
    });

    const staticItems: CompletionItem[] = [
        {
            label: "get",
            kind: CompletionItemKind.Method,
            detail: `${d}.get(id)`,
            insertText: "get($1)",
            insertTextFormat: 2,
        },
        {
            label: "getAll",
            kind: CompletionItemKind.Method,
            detail: `${d}.getAll(ids)` ,
            insertText: "getAll($1)",
            insertTextFormat: 2,
        },
        {
            label: "read",
            kind: CompletionItemKind.Method,
            detail: `${d}.read(id) — read-only instance`,
            insertText: "read($1)",
            insertTextFormat: 2,
        },
        {
            label: "load",
            kind: CompletionItemKind.Method,
            detail: `${d}.load(id) — proxy without immediate query`,
            insertText: "load($1)",
            insertTextFormat: 2,
        },
        {
            label: "list",
            kind: CompletionItemKind.Method,
            detail: `${d}.list()`,
            insertText: "list()",
            insertTextFormat: 2,
        },
        {
            label: "count",
            kind: CompletionItemKind.Method,
            detail: `${d}.count()`,
            insertText: "count()",
            insertTextFormat: 2,
        },
        {
            label: "exists",
            kind: CompletionItemKind.Method,
            detail: `${d}.exists(id)`,
            insertText: "exists($1)",
            insertTextFormat: 2,
        },
        {
            label: "findWhere",
            kind: CompletionItemKind.Method,
            detail: `${d}.findWhere(Map)`,
            insertText: "findWhere(${1:property}: ${2:value})",
            insertTextFormat: 2,
        },
        {
            label: "findAllWhere",
            kind: CompletionItemKind.Method,
            detail: `${d}.findAllWhere(Map)`,
            insertText: "findAllWhere(${1:property}: ${2:value})",
            insertTextFormat: 2,
        },
        {
            label: "findOrCreateWhere",
            kind: CompletionItemKind.Method,
            detail: `${d}.findOrCreateWhere(Map)`,
            insertText: "findOrCreateWhere(${1:property}: ${2:value})",
            insertTextFormat: 2,
        },
        {
            label: "findOrSaveWhere",
            kind: CompletionItemKind.Method,
            detail: `${d}.findOrSaveWhere(Map)`,
            insertText: "findOrSaveWhere(${1:property}: ${2:value})",
            insertTextFormat: 2,
        },
        {
            label: "findAll",
            kind: CompletionItemKind.Method,
            detail: `${d}.findAll { ... }`,
            insertText: "findAll { $1 }",
            insertTextFormat: 2,
        },
        {
            label: "withCriteria",
            kind: CompletionItemKind.Method,
            detail: `${d}.withCriteria { ... }`,
            insertText: "withCriteria {\n\t$1\n}",
            insertTextFormat: 2,
        },
        {
            label: "createCriteria",
            kind: CompletionItemKind.Method,
            detail: `${d}.createCriteria()`,
            insertText: "createCriteria()",
            insertTextFormat: 2,
        },
        {
            label: "where",
            kind: CompletionItemKind.Method,
            detail: `${d}.where { ... }`,
            insertText: "where { $1 }",
            insertTextFormat: 2,
        },
        {
            label: "whereAny",
            kind: CompletionItemKind.Method,
            detail: `${d}.whereAny { ... }`,
            insertText: "whereAny { $1 }",
            insertTextFormat: 2,
        },
        {
            label: "first",
            kind: CompletionItemKind.Method,
            detail: `${d}.first()` ,
            insertText: "first()",
            insertTextFormat: 2,
        },
        {
            label: "last",
            kind: CompletionItemKind.Method,
            detail: `${d}.last()` ,
            insertText: "last()",
            insertTextFormat: 2,
        },
        {
            label: "executeQuery",
            kind: CompletionItemKind.Method,
            detail: `${d}.executeQuery(hql)`,
            insertText: "executeQuery('${1:HQL}')",
            insertTextFormat: 2,
        },
        {
            label: "executeUpdate",
            kind: CompletionItemKind.Method,
            detail: `${d}.executeUpdate(hql)`,
            insertText: "executeUpdate('${1:HQL}')",
            insertTextFormat: 2,
        },
        {
            label: "withTransaction",
            kind: CompletionItemKind.Method,
            detail: `${d}.withTransaction { status -> ... }`,
            insertText: "withTransaction { status ->\n\t$1\n}",
            insertTextFormat: 2,
        },
        {
            label: "withSession",
            kind: CompletionItemKind.Method,
            detail: `${d}.withSession { session -> ... }`,
            insertText: "withSession { session ->\n\t$1\n}",
            insertTextFormat: 2,
        },
        {
            label: "withNewSession",
            kind: CompletionItemKind.Method,
            detail: `${d}.withNewSession { session -> ... }`,
            insertText: "withNewSession { session ->\n\t$1\n}",
            insertTextFormat: 2,
        },
    ];

    return [...staticItems, ...findByItems, ...findAllByItems, ...dynamicFinderItems];
}

// ── GORM instance completions ─────────────────────────────────────────────────

function gormInstanceCompletions(domain: DomainClass): CompletionItem[] {
    const propItems: CompletionItem[] = domain.properties.map((p) => ({
        label: p.name,
        kind: CompletionItemKind.Property,
        detail: `${p.type} — ${domain.name}`,
    }));

    const hasManyItems: CompletionItem[] = Object.entries(domain.hasMany).map(
        ([rel]) => ({
            label: rel,
            kind: CompletionItemKind.Property,
            detail: `hasMany: ${domain.hasMany[rel]}[]`,
        }),
    );

    const associationMethods: CompletionItem[] = Object.entries(domain.hasMany).flatMap(
        ([relation, type]) => {
            const suffix = capitalize(relation);
            return [
                { label: `addTo${suffix}`, kind: CompletionItemKind.Method, detail: `Add ${type} to ${relation}`, insertText: `addTo${suffix}($1)`, insertTextFormat: 2 },
                { label: `removeFrom${suffix}`, kind: CompletionItemKind.Method, detail: `Remove ${type} from ${relation}`, insertText: `removeFrom${suffix}($1)`, insertTextFormat: 2 },
            ];
        },
    );

    const instanceMethods: CompletionItem[] = [
        {
            label: "save",
            kind: CompletionItemKind.Method,
            detail: "Persists the instance",
            insertText: "save(flush: ${1:true})",
            insertTextFormat: 2,
        },
        {
            label: "save(failOnError: true)",
            kind: CompletionItemKind.Method,
            detail: "Save, throw on error",
            insertText: "save(failOnError: true)",
            insertTextFormat: 2,
        },
        {
            label: "delete",
            kind: CompletionItemKind.Method,
            detail: "Deletes the instance",
            insertText: "delete(flush: ${1:true})",
            insertTextFormat: 2,
        },
        {
            label: "validate",
            kind: CompletionItemKind.Method,
            detail: "Runs validation without saving",
            insertText: "validate()",
            insertTextFormat: 2,
        },
        {
            label: "errors",
            kind: CompletionItemKind.Property,
            detail: "ValidationErrors",
        },
        { label: "id", kind: CompletionItemKind.Property, detail: "Persistent identifier" },
        { label: "version", kind: CompletionItemKind.Property, detail: "Optimistic locking version" },
        { label: "properties", kind: CompletionItemKind.Property, detail: "Domain properties map" },
        { label: "ident", kind: CompletionItemKind.Method, detail: "Returns the persistent identifier", insertText: "ident()", insertTextFormat: 2 },
        {
            label: "hasErrors",
            kind: CompletionItemKind.Method,
            detail: "Returns true if validation errors exist",
            insertText: "hasErrors()",
            insertTextFormat: 2,
        },
        {
            label: "discard",
            kind: CompletionItemKind.Method,
            detail: "Discards unsaved changes",
            insertText: "discard()",
            insertTextFormat: 2,
        },
        {
            label: "refresh",
            kind: CompletionItemKind.Method,
            detail: "Reloads from the database",
            insertText: "refresh()",
            insertTextFormat: 2,
        },
        {
            label: "attach",
            kind: CompletionItemKind.Method,
            detail: "Re-attaches to the session",
            insertText: "attach()",
            insertTextFormat: 2,
        },
        {
            label: "isAttached",
            kind: CompletionItemKind.Method,
            detail: "True if attached to Hibernate session",
            insertText: "isAttached()",
            insertTextFormat: 2,
        },
        { label: "isDirty", kind: CompletionItemKind.Method, detail: "Checks whether the instance or a property changed", insertText: "isDirty(${1:'property'})", insertTextFormat: 2 },
        { label: "getDirtyPropertyNames", kind: CompletionItemKind.Method, detail: "Returns changed persistent property names", insertText: "getDirtyPropertyNames()", insertTextFormat: 2 },
        { label: "getPersistentValue", kind: CompletionItemKind.Method, detail: "Returns a property's original persistent value", insertText: "getPersistentValue('${1:property}')", insertTextFormat: 2 },
        { label: "merge", kind: CompletionItemKind.Method, detail: "Merges a detached instance", insertText: "merge()", insertTextFormat: 2 },
        { label: "lock", kind: CompletionItemKind.Method, detail: "Obtains a pessimistic lock", insertText: "lock()", insertTextFormat: 2 },
        { label: "clearErrors", kind: CompletionItemKind.Method, detail: "Clears validation errors", insertText: "clearErrors()", insertTextFormat: 2 },
    ];

    return [...propItems, ...hasManyItems, ...associationMethods, ...instanceMethods];
}

// ── Controller method completions ────────────────────────────────────────────

/**
 * Parses and returns all action methods from a controller file.
 * Used when the user types SwaggerController.| — shows defined actions.
 */
function controllerMethodCompletions(
    controllerName: string,
    project: GrailsProject,
): CompletionItem[] {
    const artifact = project.controllers.get(controllerName);
    if (!artifact) return [];

    let src: string;
    try {
        src = fs.readFileSync(artifact.filePath, "utf8");
    } catch {
        return [];
    }

    const methodRe =
        /^\s*(?:(?:private|protected|public)\s+)?(?:static\s+)?(?:def|\w+)\s+(\w+)\s*(?:\(|=\s*\{)/gm;
    const items: CompletionItem[] = [];
    let m: RegExpExecArray | null;
    const seen = new Set<string>();
    const skip = new Set([
        "class",
        "if",
        "for",
        "while",
        "switch",
        "try",
        "catch",
        "return",
        "static",
        "final",
        "new",
    ]);

    while ((m = methodRe.exec(src)) !== null) {
        const methodName = m[1];
        if (seen.has(methodName) || skip.has(methodName) || methodName === artifact.name) continue;
        seen.add(methodName);
        items.push({
            label: methodName,
            kind: CompletionItemKind.Method,
            detail: `${artifact.name}.${methodName}()`,
            insertText: `${methodName}($1)`,
            insertTextFormat: 2,
        });
    }
    return items;
}

// ── Service method completions ────────────────────────────────────────────────

function serviceMethodCompletions(
    serviceVarName: string,
    project: GrailsProject,
): CompletionItem[] {
    const capitalizedService =
        serviceVarName.charAt(0).toUpperCase() + serviceVarName.slice(1);

    // Direct lookup first
    let artifact = project.services.get(capitalizedService);

    // Fallback: case-insensitive search for multi-word service names
    if (!artifact) {
        const lowerVar = serviceVarName.toLowerCase();
        for (const [key, val] of project.services) {
            if (key.toLowerCase() === lowerVar) {
                artifact = val;
                break;
            }
        }
    }

    if (!artifact) return [];

    let src: string;
    try {
        src = fs.readFileSync(artifact.filePath, "utf8");
    } catch {
        return [];
    }

    const methodRe =
        /^\s*(?:(?:private|protected|public)\s+)?(?:static\s+)?(?:def|\w+)\s+(\w+)\s*(?:\(|=\s*\{)/gm;
    const items: CompletionItem[] = [];
    let m: RegExpExecArray | null;
    const seen = new Set<string>();

    // Exclude Groovy built-ins that show up as methods
    const skip = new Set([
        "class",
        "if",
        "for",
        "while",
        "switch",
        "try",
        "catch",
        "return",
        "static",
        "final",
        "new",
    ]);

    while ((m = methodRe.exec(src)) !== null) {
        const methodName = m[1];
        if (seen.has(methodName) || skip.has(methodName)) continue;
        seen.add(methodName);
        items.push({
            label: methodName,
            kind: CompletionItemKind.Method,
            detail: `${artifact.name}.${methodName}()`,
            insertText: `${methodName}($1)`,
            insertTextFormat: 2,
        });
    }
    return items;
}

// ── Controller scope completions ──────────────────────────────────────────────

function controllerScopeCompletions(
    domain: DomainClass | null,
): CompletionItem[] {
    const base: CompletionItem[] = [
        {
            label: "render",
            kind: CompletionItemKind.Method,
            detail: "Renders a response",
            insertText:
                "render(${1|view,template,text,json|}:$2 ${3:, model: [${4:key}: ${5:value}]})",
            insertTextFormat: 2,
        },
        {
            label: "redirect",
            kind: CompletionItemKind.Method,
            detail: "Redirects to another action/controller",
            insertText: "redirect(${1|action,controller,uri|}:'$2')",
            insertTextFormat: 2,
        },
        {
            label: "params",
            kind: CompletionItemKind.Variable,
            detail: "Request parameters map",
        },
        {
            label: "request",
            kind: CompletionItemKind.Variable,
            detail: "HttpServletRequest",
        },
        {
            label: "response",
            kind: CompletionItemKind.Variable,
            detail: "HttpServletResponse",
        },
        {
            label: "session",
            kind: CompletionItemKind.Variable,
            detail: "HttpSession",
        },
        {
            label: "flash",
            kind: CompletionItemKind.Variable,
            detail: "Flash scope — persists for next request only",
        },
        {
            label: "grailsApplication",
            kind: CompletionItemKind.Variable,
            detail: "GrailsApplication — configuration, metadata and application context",
        },
        {
            label: "servletContext",
            kind: CompletionItemKind.Variable,
            detail: "Jakarta ServletContext (Grails 7)",
        },
        {
            label: "controllerName",
            kind: CompletionItemKind.Variable,
            detail: "Logical name of the current controller",
        },
        {
            label: "actionName",
            kind: CompletionItemKind.Variable,
            detail: "Logical name of the current action",
        },
        {
            label: "respond",
            kind: CompletionItemKind.Method,
            detail: "REST-aware respond (content negotiation)",
            insertText: "respond ${1:object}",
            insertTextFormat: 2,
        },
        {
            label: "bindData",
            kind: CompletionItemKind.Method,
            detail: "Bind request params to a domain object",
            insertText: "bindData(${1:domainInstance}, params)",
            insertTextFormat: 2,
        },
        {
            label: "withForm",
            kind: CompletionItemKind.Method,
            detail: "Double-submit protection",
            insertText: "withForm {\n\t$1\n}.invalidToken {\n\t$2\n}",
            insertTextFormat: 2,
        },
        {
            label: "chain",
            kind: CompletionItemKind.Method,
            detail: "Pass model to the next action in a chain",
            insertText:
                "chain(action: '${1:next}', model: [${2:key}: ${3:value}])",
            insertTextFormat: 2,
        },
        {
            label: "forward",
            kind: CompletionItemKind.Method,
            detail: "Forward the current request to another action or URI",
            insertText: "forward(${1|action,controller,uri|}: '$2')",
            insertTextFormat: 2,
        },
        {
            label: "header",
            kind: CompletionItemKind.Method,
            detail: "Set an HTTP response header",
            insertText: "header '${1:name}', '${2:value}'",
            insertTextFormat: 2,
        },
        {
            label: "withFormat",
            kind: CompletionItemKind.Method,
            detail: "Content negotiation block",
            insertText:
                "withFormat {\n\thtml { render view: '${1:view}' }\n\tjson { respond ${2:object} }\n}",
            insertTextFormat: 2,
        },
    ];

    if (domain) {
        base.unshift({
            label: `${domain.name.toLowerCase()} (convention)`,
            kind: CompletionItemKind.Variable,
            detail: `Associated domain: ${domain.name}`,
            insertText: domain.name.toLowerCase(),
            insertTextFormat: 2,
        });
    }

    return base;
}

// ── render/redirect named-arg keys ───────────────────────────────────────────

function renderRedirectKeyCompletions(): CompletionItem[] {
    return [
        {
            label: "view:",
            kind: CompletionItemKind.Keyword,
            detail: "render(view: 'name')",
        },
        {
            label: "model:",
            kind: CompletionItemKind.Keyword,
            detail: "render(model: [:])",
        },
        {
            label: "template:",
            kind: CompletionItemKind.Keyword,
            detail: "render(template: 'partial')",
        },
        {
            label: "text:",
            kind: CompletionItemKind.Keyword,
            detail: "render(text: 'raw')",
        },
        {
            label: "json:",
            kind: CompletionItemKind.Keyword,
            detail: "render(json: object)",
        },
        { label: "contentType:", kind: CompletionItemKind.Keyword },
        { label: "encoding:", kind: CompletionItemKind.Keyword },
        {
            label: "action:",
            kind: CompletionItemKind.Keyword,
            detail: "redirect(action: 'name')",
        },
        {
            label: "controller:",
            kind: CompletionItemKind.Keyword,
            detail: "redirect(controller: 'name')",
        },
        { label: "uri:", kind: CompletionItemKind.Keyword },
        { label: "url:", kind: CompletionItemKind.Keyword },
        {
            label: "permanent:",
            kind: CompletionItemKind.Keyword,
            detail: "redirect(permanent: true) — 301",
        },
    ];
}

function serviceNamesCompletions(project: GrailsProject): CompletionItem[] {
    return [...project.services.values()].map((s) => ({
        label: s.simpleName + "Service",
        kind: CompletionItemKind.Class,
        detail: `Inject ${s.name}`,
        insertText: `${s.simpleName}Service`,
        insertTextFormat: 2,
    }));
}

/**
 * Returns only services that are declared in the current file.
 * A service declaration looks like:  def bookService  or  BookService bookService
 */
function declaredServiceCompletions(
    docText: string,
    project: GrailsProject,
): CompletionItem[] {
    const declared = new Set<string>();
    const lines = docText.split("\n");

    for (const line of lines) {
        // "def bookService" or "BookService bookService"
        const defMatch = /\bdef\s+(\w+Service)\b/.exec(line);
        if (defMatch) declared.add(defMatch[1]);

        const typedMatch = /\b([A-Z]\w+Service)\s+(\w+Service)\b/.exec(line);
        if (typedMatch) declared.add(typedMatch[2]);
    }

    // Compare case-insensitively: simpleName is lowercase ("fusiontoken")
    // but declared preserves camelCase ("fusionTokenService")
    const declaredLower = new Set([...declared].map((d) => d.toLowerCase()));

    return [...project.services.values()]
        .filter((s) => declaredLower.has(s.simpleName + "service"))
        .map((s) => {
            // Recover the original camelCase injection name from declared
            const key =
                [...declared].find(
                    (d) => d.toLowerCase() === s.simpleName + "service",
                ) ?? s.simpleName + "Service";
            return {
                label: key,
                kind: CompletionItemKind.Class,
                detail: `Inject ${s.name}`,
                insertText: key,
                insertTextFormat: 2,
            };
        });
}

// ── Artifact name completions (bare word: SwaggerController|  TestService|) ──

/**
 * Suggests controller and service class names when user types a capitalized prefix.
 * Used before the dot — e.g. "def x = Swagger" → suggests "SwaggerController".
 * Inserting selects the name and adds "." so the user can keep typing the method.
 */
function artifactNameCompletions(
    typedPrefix: string,
    project: GrailsProject,
): CompletionItem[] {
    const lower = typedPrefix.toLowerCase();
    const items: CompletionItem[] = [];

    for (const [name, ctrl] of project.controllers) {
        if (!name.toLowerCase().startsWith(lower)) continue;
        items.push({
            label: name,
            kind: CompletionItemKind.Class,
            detail: "Controller",
            insertText: name,
            filterText: name,
            commitCharacters: ["."],
        });
    }

    for (const [name, svc] of project.services) {
        if (!name.toLowerCase().startsWith(lower)) continue;
        items.push({
            label: name,
            kind: CompletionItemKind.Class,
            detail: "Service",
            insertText: name,
            filterText: name,
            commitCharacters: ["."],
        });
    }

    const existingNames = new Set(items.map((item) => String(item.label)));
    for (const [name, candidates] of project.sourceClassesBySimpleName) {
        if (existingNames.has(name) || !name.toLowerCase().startsWith(lower))
            continue;
        const candidate = candidates[0];
        items.push({
            label: name,
            kind:
                candidate.declarationKind === "interface"
                    ? CompletionItemKind.Interface
                    : candidate.declarationKind === "enum"
                      ? CompletionItemKind.Enum
                      : CompletionItemKind.Class,
            detail:
                candidates.length === 1
                    ? candidate.qualifiedName
                    : `${candidates.length} project types named ${name}`,
            insertText: name,
            filterText: name,
            commitCharacters: ["."],
        });
    }

    return items;
}

// ─── Public entry point ───────────────────────────────────────────────────────

export function getCompletions(
    doc: TextDocument,
    params: TextDocumentPositionParams,
    project: GrailsProject | null,
): CompletionItem[] {
    if (project) {
        const gspCompletions = getGspCompletions(doc, params, project);
        if (gspCompletions) return gspCompletions;
        const gormDslCompletions = getGormDslCompletions(doc, params, project);
        if (gormDslCompletions) return gormDslCompletions;
    }
    const ctx = detectContext(doc, params, project);
    const filePath = uriToPath(doc.uri);

    switch (ctx.kind) {
        case "import":
            return project
                ? importCompletions(
                      project,
                      ctx.instanceName ?? "",
                      params.position.line,
                      ctx.importStartCol ?? 0,
                      params.position.character,
                  )
                : [];

        case "string_controller":
            return project ? controllerNameCompletions(project) : [];

        case "string_action":
            return project
                ? actionNameCompletions(
                      ctx.targetController ?? "",
                      project,
                      filePath,
                  )
                : [];

        case "string_view":
            return project
                ? viewPathCompletions(ctx.viewPrefix ?? "", project, filePath)
                : [];

        case "render_redirect_key":
            return renderRedirectKeyCompletions();

        case "domain_name":
            return project && ctx.instanceName
                ? domainNameCompletions(
                      ctx.instanceName,
                      project,
                      ctx.importedNames,
                  )
                : [];

        case "gorm_static_and": {
            const domain = project?.domains.get(ctx.domainName!);
            return domain && ctx.finderPrefix
                ? gormStaticAndCompletions(ctx.finderPrefix, domain)
                : [];
        }

        case "gorm_static": {
            const domain = project?.domains.get(ctx.domainName!);
            if (!domain) return [];
            const base = gormStaticCompletions(domain);
            // If the user has already typed a complete findByX (e.g. "findByNameA"),
            // also include And/Or items so VS Code can filter them as typing continues.
            // This is needed because non-trigger letters don't re-invoke the LSP.
            if (
                ctx.finderPrefix &&
                /^(?:find(?:All)?By|listBy|countBy|existsBy)[A-Z]\w+$/.test(
                    ctx.finderPrefix,
                )
            ) {
                return [
                    ...base,
                    ...gormStaticAndCompletions(ctx.finderPrefix, domain),
                ];
            }
            return base;
        }

        case "gorm_instance": {
            const domain = project?.domains.get(ctx.domainName!);
            return domain ? gormInstanceCompletions(domain) : [];
        }

        case "controller_static":
            return project && ctx.controllerName
                ? controllerMethodCompletions(ctx.controllerName, project)
                : [];

        case "service_injection":
            return project && ctx.instanceName
                ? serviceMethodCompletions(ctx.instanceName, project)
                : [];

        case "source_members":
            return project && ctx.sourceName
                ? sourceMemberCompletions(ctx.sourceName, project)
                : [];

        case "artifact_name":
            return project && ctx.artifactPrefix
                ? artifactNameCompletions(ctx.artifactPrefix, project)
                : [];

        case "generic_grails":
        default: {
            const domain = project
                ? inferDomainFromController(filePath, project)
                : null;
            const base = controllerScopeCompletions(domain);
            const services = project
                ? declaredServiceCompletions(doc.getText(), project)
                : [];
            // Only include imported domain names — not all domains in the project.
            // Prevents showing unrelated domains when user types any uppercase letter.
            const importedNames = project
                ? parseImportedNames(doc.getText(), project)
                : new Set<string>();
            if (project) {
                for (const domain of project.domains.values()) {
                    if (isDomainAccessible(domain, doc, false, importedNames)) importedNames.add(domain.name);
                }
            }
            const domainNames: CompletionItem[] =
                project && importedNames.size > 0
                    ? [...project.domains.values()]
                          .filter((d) => importedNames.has(d.name))
                          .map(
                              (d) =>
                                  ({
                                      label: d.name,
                                      kind: CompletionItemKind.Class,
                                      detail: `Domain class`,
                                      insertText: d.name,
                                      sortText: "0" + d.name,
                                  }) as CompletionItem,
                          )
                    : [];
            return [...base, ...services, ...domainNames];
        }
    }
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
