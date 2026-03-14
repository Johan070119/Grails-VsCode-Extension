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

// ─── Context detection ────────────────────────────────────────────────────────

type CompletionKind =
    | "import" // import com.example.|
    | "gorm_static" // Book.|
    | "gorm_instance" // book.|
    | "service_injection" // bookService.|
    | "string_controller" // controller: "b|"  or  controller: '|'
    | "string_action" // action: "lo|"  — needs controller context
    | "string_view" // view: "/lay|"  or  view: "sh|"
    | "render_redirect_key" // render(|  or  redirect(|  — named arg keys
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

function detectContext(
    doc: TextDocument,
    params: TextDocumentPositionParams,
    project: GrailsProject | null,
): CompletionContext {
    const lineUpTo = getLineUpToCursor(doc, params);
    const filePath = doc.uri.replace(/^file:\/\//, "");
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

    // ── GORM static: Book.| ──────────────────────────────────────────────────
    const staticMatch = /\b([A-Z]\w+)\.(\w*)$/.exec(lineUpTo);
    if (staticMatch && project?.domains.has(staticMatch[1])) {
        return { kind: "gorm_static", domainName: staticMatch[1] };
    }

    // ── service instance: bookService.| ──────────────────────────────────────
    const serviceMatch = /\b(\w+Service)\??\.(\w*)$/.exec(lineUpTo);
    if (serviceMatch && project) {
        return { kind: "service_injection", instanceName: serviceMatch[1] };
    }

    // ── GORM instance: book.| ─────────────────────────────────────────────────
    const instanceMatch = /\b([a-z]\w*)\??\.(\w*)$/.exec(lineUpTo);
    if (instanceMatch && project) {
        const varName = instanceMatch[1];
        const domainName = [...project.domains.keys()].find(
            (d) => d.toLowerCase() === varName.toLowerCase(),
        );
        if (domainName) {
            return { kind: "gorm_instance", domainName, instanceName: varName };
        }
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
    const actionRe = /^\s*def\s+(\w+)\s*\(/gm;
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

// ── GORM static completions ───────────────────────────────────────────────────

function gormStaticCompletions(domain: DomainClass): CompletionItem[] {
    const d = domain.name;
    const props = domain.properties.map((p) => p.name);

    const findByItems = props.map(
        (p) =>
            ({
                label: `findBy${capitalize(p)}`,
                kind: CompletionItemKind.Method,
                detail: `${d} (GORM dynamic finder)`,
                documentation: {
                    kind: MarkupKind.Markdown,
                    value: `Finds the first \`${d}\` where \`${p}\` matches.`,
                },
                insertText: `findBy${capitalize(p)}($1)`,
                insertTextFormat: 2,
            }) as CompletionItem,
    );

    const findAllByItems = props.map(
        (p) =>
            ({
                label: `findAllBy${capitalize(p)}`,
                kind: CompletionItemKind.Method,
                detail: `${d} (GORM dynamic finder)`,
                insertText: `findAllBy${capitalize(p)}($1)`,
                insertTextFormat: 2,
            }) as CompletionItem,
    );

    const staticItems: CompletionItem[] = [
        {
            label: "get",
            kind: CompletionItemKind.Method,
            detail: `${d}.get(id)`,
            insertText: "get($1)",
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
            label: "executeQuery",
            kind: CompletionItemKind.Method,
            detail: `${d}.executeQuery(hql)`,
            insertText: "executeQuery('${1:HQL}')",
            insertTextFormat: 2,
        },
    ];

    return [...staticItems, ...findByItems, ...findAllByItems];
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
    ];

    return [...propItems, ...hasManyItems, ...instanceMethods];
}

// ── Service method completions ────────────────────────────────────────────────

function serviceMethodCompletions(
    serviceVarName: string,
    project: GrailsProject,
): CompletionItem[] {
    const capitalizedService =
        serviceVarName.charAt(0).toUpperCase() + serviceVarName.slice(1);
    const artifact = project.services.get(capitalizedService);
    if (!artifact) return [];

    let src: string;
    try {
        src = fs.readFileSync(artifact.filePath, "utf8");
    } catch {
        return [];
    }

    const methodRe =
        /^\s*(?:private\s+|protected\s+|public\s+)?(?:def|\w+)\s+(\w+)\s*\(/gm;
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

// ─── Public entry point ───────────────────────────────────────────────────────

export function getCompletions(
    doc: TextDocument,
    params: TextDocumentPositionParams,
    project: GrailsProject | null,
): CompletionItem[] {
    const ctx = detectContext(doc, params, project);
    const filePath = doc.uri.replace(/^file:\/\//, "");

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

        case "gorm_static": {
            const domain = project?.domains.get(ctx.domainName!);
            return domain ? gormStaticCompletions(domain) : [];
        }

        case "gorm_instance": {
            const domain = project?.domains.get(ctx.domainName!);
            return domain ? gormInstanceCompletions(domain) : [];
        }

        case "service_injection":
            return project && ctx.instanceName
                ? serviceMethodCompletions(ctx.instanceName, project)
                : [];

        case "generic_grails":
        default: {
            const domain = project
                ? inferDomainFromController(filePath, project)
                : null;
            const base = controllerScopeCompletions(domain);
            const services = project ? serviceNamesCompletions(project) : [];
            return [...base, ...services];
        }
    }
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
