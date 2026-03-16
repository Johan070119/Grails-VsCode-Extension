import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient;
let treeProvider: GrailsProjectProvider;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findGrailsRoot(startPath: string): string | null {
    let current = path.dirname(startPath);
    for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(current, "grails-app"))) return current;
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return null;
}

function getWorkspaceRoot(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return null;
    for (const f of folders) {
        if (fs.existsSync(path.join(f.uri.fsPath, "grails-app")))
            return f.uri.fsPath;
    }
    return null;
}

function detectGrailsVersion(root: string): string {
    // Grails 3+ — gradle.properties
    const gp = path.join(root, "gradle.properties");
    if (fs.existsSync(gp)) {
        const m = /grailsVersion\s*=\s*([\d.]+[-\w]*)/.exec(
            fs.readFileSync(gp, "utf8"),
        );
        if (m) return m[1];
    }
    // Grails 3+ — build.gradle or build.gradle.kts
    for (const bf of ["build.gradle", "build.gradle.kts"]) {
        const p = path.join(root, bf);
        if (!fs.existsSync(p)) continue;
        const src = fs.readFileSync(p, "utf8");
        const m = /grailsVersion[^=\n]*=\s*["']?([\d.]+[-\w]*)/.exec(src);
        if (m) return m[1];
    }
    // Grails 2 — application.properties
    const ap = path.join(root, "application.properties");
    if (fs.existsSync(ap)) {
        const m = /app\.grails\.version\s*=\s*([\d.]+[-\w]*)/.exec(
            fs.readFileSync(ap, "utf8"),
        );
        if (m) return m[1];
    }
    return "desconocida";
}

function runGrailsCommand(cmd: string): void {
    let t = vscode.window.terminals.find((t) => t.name === "Grails");
    if (!t) t = vscode.window.createTerminal({ name: "Grails" });
    t.show();
    t.sendText(cmd);
}

// ─── Templates (compatible Grails 2–7+) ──────────────────────────────────────
//
// All templates use the minimal Groovy class structure that works across every
// Grails version:
//   Grails 2   — plain Groovy classes in grails-app/
//   Grails 3+  — same structure, Gradle-based build
//   Grails 4+  — same + GORM 7, Spring Boot 2
//   Grails 5+  — same + Groovy 3, Spring Boot 2.6
//   Grails 6+  — same + Jakarta EE (javax→jakarta), Spring Boot 3
//   Grails 7+  — same + Groovy 4, Spring Boot 3.2
// No version-specific imports are added — the developer adds them as needed.

function pkgLine(pkg: string): string {
    return pkg ? "package " + pkg + "\n\n" : "";
}

function controllerTemplate(name: string, pkg: string): string {
    return (
        pkgLine(pkg) +
        "class " +
        name +
        " {\n\n" +
        "    def index() { }\n\n" +
        "}\n"
    );
}

function domainTemplate(name: string, pkg: string): string {
    return (
        pkgLine(pkg) +
        "class " +
        name +
        " {\n\n" +
        "    static constraints = {\n" +
        "    }\n\n" +
        "    static mapping = {\n" +
        "    }\n\n" +
        "}\n"
    );
}

// Service template varies by Grails version:
//   Grails 2.0-2.3   -> static transactional = true  (no annotation support)
//   Grails 2.4+      -> @Transactional (grails.transaction.Transactional)
//   Grails 6.x-7.x+ -> @Transactional (grails.gorm.transactions.Transactional)
function serviceTemplate(name: string, pkg: string, version?: string): string {
    const parts = (version ?? "").split(".");
    const major = parseInt(parts[0], 10) || 3;
    const minor = parseInt(parts[1], 10) || 0;

    // Only very old Grails 2.0-2.3 used static transactional
    if (major === 2 && minor < 4) {
        return (
            pkgLine(pkg) +
            "class " +
            name +
            " {\n\n" +
            "    static transactional = true\n\n" +
            "    def serviceMethod() {\n\n" +
            "    }\n\n" +
            "}\n"
        );
    }

    if (major >= 6) {
        return (
            pkgLine(pkg) +
            "import grails.gorm.transactions.Transactional\n\n" +
            "@Transactional\n" +
            "class " +
            name +
            " {\n\n" +
            "    def serviceMethod() {\n\n" +
            "    }\n\n" +
            "}\n"
        );
    }

    // Grails 2.4+, 3.x, 4.x, 5.x and unknown
    return (
        pkgLine(pkg) +
        "import grails.transaction.Transactional\n\n" +
        "@Transactional\n" +
        "class " +
        name +
        " {\n\n" +
        "    def serviceMethod() {\n\n" +
        "    }\n\n" +
        "}\n"
    );
}

function taglibTemplate(name: string, pkg: string): string {
    return (
        pkgLine(pkg) +
        "class " +
        name +
        " {\n\n" +
        '    static namespace = "g"\n\n' +
        "}\n"
    );
}

function gspTemplate(viewName: string): string {
    return (
        "<!DOCTYPE html>\n" +
        "<html>\n" +
        "<head>\n" +
        '    <meta name="layout" content="main"/>\n' +
        "    <title>" +
        viewName +
        "</title>\n" +
        "</head>\n" +
        "<body>\n\n" +
        "</body>\n" +
        "</html>\n"
    );
}

// Infer Groovy package from folder path relative to a known source root.
// Works for both grails-app/* and src/main/groovy layouts.
function inferPackage(folderPath: string): string {
    const rel = folderPath.replace(/\\/g, "/");
    const markers = [
        "grails-app/controllers",
        "grails-app/domain",
        "grails-app/services",
        "grails-app/taglib",
        "grails-app/utils",
        "src/main/groovy",
    ];
    for (const marker of markers) {
        const idx = rel.indexOf(marker);
        if (idx !== -1) {
            const sub = rel.slice(idx + marker.length).replace(/^\//, "");
            return sub ? sub.replace(/\//g, ".") : "";
        }
    }
    return "";
}

// ─── File helpers ─────────────────────────────────────────────────────────────

async function writeNewFile(
    folder: string,
    fileName: string,
    content: string,
): Promise<void> {
    const full = path.join(folder, fileName);
    if (fs.existsSync(full)) {
        vscode.window.showWarningMessage("Ya existe: " + fileName);
        return;
    }
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(full, content, "utf8");
    const doc = await vscode.workspace.openTextDocument(full);
    await vscode.window.showTextDocument(doc);
}

async function createArtefact(
    item: GrailsTreeItem | undefined,
    prompt: string,
    suffix: string,
    tplFn: (name: string, pkg: string, version?: string) => string,
): Promise<void> {
    const folder = item?.node.fsPath;
    if (!folder) return;

    const input = await vscode.window.showInputBox({
        prompt,
        placeHolder: "Book  o  com/example/Book",
        validateInput: (v) =>
            v.trim() ? null : "El nombre no puede estar vacio",
    });
    if (!input) return;

    const parts = input
        .replace(/\\/g, "/")
        .split("/")
        .filter((p) => p.length > 0);
    const rawName = parts[parts.length - 1];
    const sub = parts.slice(0, -1).join("/");
    const className = rawName.endsWith(suffix) ? rawName : rawName + suffix;
    const targetDir = sub ? path.join(folder, sub) : folder;
    const pkg = inferPackage(targetDir);
    const version = treeProvider?.getVersion() ?? "";

    await writeNewFile(
        targetDir,
        className + ".groovy",
        tplFn(className, pkg, version),
    );
}

// ─── Node types ───────────────────────────────────────────────────────────────

// contextValue used in package.json menus "when" clauses.
// Specific folder types get a unique value; generic subfolders get "grailsFolder".
// Files get "grailsFile".
// This lets us show the right primary action per folder type.
type NodeKind =
    | "version-label"
    | "root-group"
    | "grailsFolder_controllers"
    | "grailsFolder_domain"
    | "grailsFolder_services"
    | "grailsFolder_views"
    | "grailsFolder_taglib"
    | "grailsFolder_conf"
    | "grailsFolder_i18n"
    | "grailsFolder_utils"
    | "grailsFolder_assets"
    | "grailsFolder"
    | "grailsFile";

interface GrailsNode {
    label: string;
    fsPath: string;
    kind: NodeKind;
    iconId: string;
    description?: string;
}

// ─── Tree item ────────────────────────────────────────────────────────────────

export class GrailsTreeItem extends vscode.TreeItem {
    constructor(
        public readonly node: GrailsNode,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    ) {
        super(node.label, collapsibleState);
        this.resourceUri = vscode.Uri.file(node.fsPath);
        this.iconPath = new vscode.ThemeIcon(node.iconId);
        this.contextValue = node.kind;
        if (node.description) this.description = node.description;

        if (node.kind === "grailsFile") {
            this.command = {
                command: "vscode.open",
                title: "Open",
                arguments: [vscode.Uri.file(node.fsPath)],
            };
        }
    }
}

// ─── Tree provider ────────────────────────────────────────────────────────────

class GrailsProjectProvider implements vscode.TreeDataProvider<GrailsTreeItem> {
    private _onChange = new vscode.EventEmitter<GrailsTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onChange.event;
    private root: string | null = null;
    private version = "";

    constructor() {
        vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh());
        this.detectRoot();
    }

    refresh(): void {
        this.detectRoot();
        this._onChange.fire(undefined);
    }
    getRoot(): string | null {
        return this.root;
    }
    getVersion(): string {
        return this.version;
    }

    private detectRoot(): void {
        this.root = getWorkspaceRoot();
        this.version = this.root ? detectGrailsVersion(this.root) : "";
    }

    getTreeItem(el: GrailsTreeItem): vscode.TreeItem {
        return el;
    }

    getChildren(el?: GrailsTreeItem): GrailsTreeItem[] {
        if (!this.root) return [];
        if (!el) return this.topLevel(this.root);
        if (el.node.kind === "version-label") return [];
        return this.children(el.node.fsPath);
    }

    private topLevel(root: string): GrailsTreeItem[] {
        const items: GrailsTreeItem[] = [];

        // Version badge at top
        items.push(
            new GrailsTreeItem(
                {
                    label: "Grails " + this.version,
                    fsPath: root,
                    kind: "version-label",
                    iconId: "package",
                    description: "version actual",
                },
                vscode.TreeItemCollapsibleState.None,
            ),
        );

        // grails-app folder
        const ga = path.join(root, "grails-app");
        if (fs.existsSync(ga)) {
            items.push(
                new GrailsTreeItem(
                    {
                        label: "grails-app",
                        fsPath: ga,
                        kind: "root-group",
                        iconId: "package",
                    },
                    vscode.TreeItemCollapsibleState.Expanded,
                ),
            );
        }

        // src dirs (Grails 3+)
        for (const [rel, icon] of [
            ["src/main/groovy", "symbol-method"],
            ["src/main/resources", "file-binary"],
            ["src/test/groovy", "beaker"],
            ["src/integration-test/groovy", "beaker"],
        ] as [string, string][]) {
            const p = path.join(root, rel);
            if (fs.existsSync(p))
                items.push(this.mkFolder(rel, p, icon, "grailsFolder"));
        }

        // web-app (Grails 2) or src/main/webapp (Grails 3+)
        for (const wa of ["web-app", "src/main/webapp"]) {
            const p = path.join(root, wa);
            if (fs.existsSync(p)) {
                items.push(this.mkFolder(wa, p, "browser", "grailsFolder"));
                break;
            }
        }

        return items;
    }

    private children(folderPath: string): GrailsTreeItem[] {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(folderPath, { withFileTypes: true });
        } catch {
            return [];
        }

        const folders: GrailsTreeItem[] = [];
        const files: GrailsTreeItem[] = [];

        for (const e of entries) {
            if (e.name.startsWith(".")) continue;
            if (["build", ".gradle", "node_modules"].includes(e.name)) continue;
            const full = path.join(folderPath, e.name);
            if (e.isDirectory()) {
                folders.push(
                    this.mkFolder(
                        e.name,
                        full,
                        this.dirIcon(e.name),
                        this.dirKind(e.name),
                    ),
                );
            } else {
                files.push(this.mkFile(e.name, full));
            }
        }
        return [...folders, ...files];
    }

    private dirKind(name: string): NodeKind {
        const m: Record<string, NodeKind> = {
            controllers: "grailsFolder_controllers",
            domain: "grailsFolder_domain",
            services: "grailsFolder_services",
            views: "grailsFolder_views",
            taglib: "grailsFolder_taglib",
            conf: "grailsFolder_conf",
            i18n: "grailsFolder_i18n",
            utils: "grailsFolder_utils",
            assets: "grailsFolder_assets",
        };
        return m[name] ?? "grailsFolder";
    }

    private dirIcon(name: string): string {
        const m: Record<string, string> = {
            controllers: "symbol-class",
            domain: "database",
            services: "symbol-interface",
            views: "file-code",
            conf: "settings-gear",
            i18n: "globe",
            taglib: "tag",
            utils: "tools",
            assets: "file-media",
        };
        return m[name] ?? "folder";
    }

    private mkFolder(
        label: string,
        fsPath: string,
        iconId: string,
        kind: NodeKind,
    ): GrailsTreeItem {
        return new GrailsTreeItem(
            { label, fsPath, kind, iconId },
            vscode.TreeItemCollapsibleState.Collapsed,
        );
    }

    private mkFile(label: string, fsPath: string): GrailsTreeItem {
        const icon = label.endsWith(".groovy")
            ? "symbol-class"
            : label.endsWith(".gsp")
              ? "file-code"
              : label.endsWith(".yml") || label.endsWith(".yaml")
                ? "settings"
                : label.endsWith(".xml")
                  ? "file-code"
                  : label.endsWith(".properties")
                    ? "list-unordered"
                    : "file";
        return new GrailsTreeItem(
            { label, fsPath, kind: "grailsFile", iconId: icon },
            vscode.TreeItemCollapsibleState.None,
        );
    }
}

// ─── GSP CodeLens ─────────────────────────────────────────────────────────────

class GrailsGspCodeLensProvider implements vscode.CodeLensProvider {
    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const fp = document.uri.fsPath;
        if (!fp.endsWith("Controller.groovy")) return [];

        const root = findGrailsRoot(fp);
        if (!root) return [];

        const ctrlName = path.basename(fp, "Controller.groovy").toLowerCase();
        const viewsDir = path.join(root, "grails-app", "views", ctrlName);
        if (!fs.existsSync(viewsDir)) return [];

        const lenses: vscode.CodeLens[] = [];
        const docLines = document.getText().split("\n");
        const re = /^\s*def\s+(\w+)\s*(?:\(|=\s*[{])/;

        for (let i = 0; i < docLines.length; i++) {
            const m = re.exec(docLines[i]);
            if (!m) continue;
            const gsp = path.join(viewsDir, m[1] + ".gsp");
            const tpl = path.join(viewsDir, "_" + m[1] + ".gsp");
            const resolved = fs.existsSync(gsp)
                ? gsp
                : fs.existsSync(tpl)
                  ? tpl
                  : null;
            if (!resolved) continue;

            lenses.push(
                new vscode.CodeLens(
                    new vscode.Range(i, 0, i, docLines[i].length),
                    {
                        title: "$(file-code) " + path.basename(resolved),
                        command: "vscode.open",
                        arguments: [vscode.Uri.file(resolved)],
                        tooltip: "Abrir " + path.basename(resolved),
                    },
                ),
            );
        }
        return lenses;
    }
}

// ─── Package refactor ─────────────────────────────────────────────────────────

/**
 * Scans all .groovy files inside a folder tree and updates the `package` declaration
 * when it contains oldPkg (or a sub-package of it).
 *
 * Example: renaming "apiportalsocios/security" to "apiportalsocios/auth"
 *   package apiportalsocios.security       → package apiportalsocios.auth
 *   package apiportalsocios.security.util  → package apiportalsocios.auth.util
 *
 * Only modifies the first non-empty, non-comment line that starts with "package ".
 * All other content is left untouched.
 */
function refactorPackagesInFolder(
    folderPath: string,
    oldPkg: string,
    newPkg: string,
): number {
    if (!oldPkg) return 0;
    let count = 0;

    function walk(dir: string): void {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                walk(full);
                continue;
            }
            if (!e.name.endsWith(".groovy")) continue;

            const src = fs.readFileSync(full, "utf8");
            const lines = src.split("\n");

            // Find the package line (first non-empty non-comment line that is "package ...")
            let pkgLineIdx = -1;
            for (let i = 0; i < lines.length; i++) {
                const t = lines[i].trim();
                if (
                    t === "" ||
                    t.startsWith("//") ||
                    t.startsWith("/*") ||
                    t.startsWith("*")
                )
                    continue;
                if (t.startsWith("package ")) {
                    pkgLineIdx = i;
                }
                break;
            }
            if (pkgLineIdx === -1) continue;

            const currentPkg = lines[pkgLineIdx]
                .replace(/^package\s+/, "")
                .trim();

            // Update if current package equals oldPkg or starts with oldPkg + "."
            let updatedPkg: string | null = null;
            if (currentPkg === oldPkg) {
                updatedPkg = newPkg;
            } else if (currentPkg.startsWith(oldPkg + ".")) {
                updatedPkg = newPkg + currentPkg.slice(oldPkg.length);
            }

            if (updatedPkg !== null) {
                lines[pkgLineIdx] = "package " + updatedPkg;
                fs.writeFileSync(full, lines.join("\n"), "utf8");
                count++;
            }
        }
    }

    walk(folderPath);
    return count;
}

function registerContextCommands(ctx: vscode.ExtensionContext): void {
    // ── Create controller ─────────────────────────────────────────────────────
    ctx.subscriptions.push(
        vscode.commands.registerCommand(
            "grails.ctx.createController",
            async (item?: GrailsTreeItem) => {
                await createArtefact(
                    item,
                    "Nombre del controller (ej. Book o com/example/Book)",
                    "Controller",
                    controllerTemplate,
                );
            },
        ),
    );

    // ── Create domain ─────────────────────────────────────────────────────────
    ctx.subscriptions.push(
        vscode.commands.registerCommand(
            "grails.ctx.createDomain",
            async (item?: GrailsTreeItem) => {
                await createArtefact(
                    item,
                    "Nombre del domain class (ej. Book o com/example/Book)",
                    "",
                    domainTemplate,
                );
            },
        ),
    );

    // ── Create service ────────────────────────────────────────────────────────
    ctx.subscriptions.push(
        vscode.commands.registerCommand(
            "grails.ctx.createService",
            async (item?: GrailsTreeItem) => {
                await createArtefact(
                    item,
                    "Nombre del service (ej. Book o com/example/Book)",
                    "Service",
                    serviceTemplate,
                );
            },
        ),
    );

    // ── Create taglib ─────────────────────────────────────────────────────────
    ctx.subscriptions.push(
        vscode.commands.registerCommand(
            "grails.ctx.createTagLib",
            async (item?: GrailsTreeItem) => {
                await createArtefact(
                    item,
                    "Nombre del TagLib (ej. Book)",
                    "TagLib",
                    taglibTemplate,
                );
            },
        ),
    );

    // ── Create GSP view ───────────────────────────────────────────────────────
    ctx.subscriptions.push(
        vscode.commands.registerCommand(
            "grails.ctx.createView",
            async (item?: GrailsTreeItem) => {
                const folder = item?.node.fsPath;
                if (!folder) return;

                const input = await vscode.window.showInputBox({
                    prompt: "Nombre de la vista (ej. show  o  sub/show)",
                    placeHolder: "show.gsp",
                    validateInput: (v) =>
                        v.trim() ? null : "El nombre no puede estar vacío",
                });
                if (!input) return;

                const parts = input
                    .replace(/\\/g, "/")
                    .split("/")
                    .filter((p) => p.length > 0);
                const rawName = parts[parts.length - 1];
                const sub = parts.slice(0, -1).join("/");
                const fileName = rawName.endsWith(".gsp")
                    ? rawName
                    : rawName + ".gsp";
                const viewName = rawName.replace(/\.gsp$/, "");
                const targetDir = sub ? path.join(folder, sub) : folder;

                await writeNewFile(targetDir, fileName, gspTemplate(viewName));
            },
        ),
    );

    // ── Create folder ─────────────────────────────────────────────────────────
    ctx.subscriptions.push(
        vscode.commands.registerCommand(
            "grails.ctx.createFolder",
            async (item?: GrailsTreeItem) => {
                const base = item?.node.fsPath ?? getWorkspaceRoot();
                if (!base) return;

                const name = await vscode.window.showInputBox({
                    prompt: "Nombre de la carpeta (puede incluir sub/carpetas)",
                    validateInput: (v) =>
                        v.trim() ? null : "El nombre no puede estar vacío",
                });
                if (!name) return;

                const newPath = path.join(base, name.replace(/\\/g, "/"));
                if (fs.existsSync(newPath)) {
                    vscode.window.showWarningMessage("Ya existe: " + name);
                    return;
                }
                fs.mkdirSync(newPath, { recursive: true });
                treeProvider.refresh();
                vscode.window.showInformationMessage("Carpeta creada: " + name);
            },
        ),
    );

    // ── Create generic file ───────────────────────────────────────────────────
    ctx.subscriptions.push(
        vscode.commands.registerCommand(
            "grails.ctx.createFile",
            async (item?: GrailsTreeItem) => {
                const base = item?.node.fsPath ?? getWorkspaceRoot();
                if (!base) return;

                const input = await vscode.window.showInputBox({
                    prompt: "Nombre con extensión (ej. Config.groovy, index.gsp, messages.properties)",
                    validateInput: (v) => {
                        if (!v.trim()) return "El nombre no puede estar vacío";
                        if (!v.includes("."))
                            return "Incluye la extensión (ej. .groovy, .gsp, .yml)";
                        return null;
                    },
                });
                if (!input) return;

                const parts = input
                    .replace(/\\/g, "/")
                    .split("/")
                    .filter((p) => p.length > 0);
                const fileName = parts[parts.length - 1];
                const sub = parts.slice(0, -1).join("/");
                const targetDir = sub ? path.join(base, sub) : base;

                await writeNewFile(targetDir, fileName, "");
            },
        ),
    );

    // ── Rename file or folder (with package refactor for folders) ────────────
    ctx.subscriptions.push(
        vscode.commands.registerCommand(
            "grails.ctx.rename",
            async (item?: GrailsTreeItem) => {
                const oldPath = item?.node.fsPath;
                if (!oldPath) return;

                const oldName = path.basename(oldPath);
                const isDir = fs.statSync(oldPath).isDirectory();

                const newName = await vscode.window.showInputBox({
                    prompt: isDir ? "Renombrar carpeta" : "Renombrar archivo",
                    value: oldName,
                    validateInput: (v) => {
                        if (!v.trim()) return "El nombre no puede estar vacío";
                        if (v === oldName) return "El nombre es el mismo";
                        return null;
                    },
                });
                if (!newName) return;

                const newPath = path.join(path.dirname(oldPath), newName);
                if (fs.existsSync(newPath)) {
                    vscode.window.showWarningMessage("Ya existe: " + newName);
                    return;
                }

                // For folders: offer to refactor package declarations inside
                if (isDir) {
                    const oldPkg = inferPackage(oldPath);
                    const newPkg = inferPackage(
                        newPath.replace(oldPath, newPath),
                    );

                    // Rename first, then refactor packages inside the renamed folder
                    fs.renameSync(oldPath, newPath);

                    // Compute the new package based on the renamed path
                    const computedNewPkg = inferPackage(newPath);

                    if (oldPkg && computedNewPkg && oldPkg !== computedNewPkg) {
                        const answer =
                            await vscode.window.showInformationMessage(
                                "Actualizar declaraciones package en los archivos .groovy?",
                                { modal: false },
                                "Actualizar",
                                "No",
                            );
                        if (answer === "Actualizar") {
                            const count = refactorPackagesInFolder(
                                newPath,
                                oldPkg,
                                computedNewPkg,
                            );
                            vscode.window.showInformationMessage(
                                "Package actualizado en " +
                                    count +
                                    " archivo(s): " +
                                    oldPkg +
                                    " → " +
                                    computedNewPkg,
                            );
                        }
                    }
                } else {
                    fs.renameSync(oldPath, newPath);
                }

                treeProvider.refresh();
            },
        ),
    );

    // ── Delete file or folder ─────────────────────────────────────────────────
    ctx.subscriptions.push(
        vscode.commands.registerCommand(
            "grails.ctx.delete",
            async (item?: GrailsTreeItem) => {
                const targetPath = item?.node.fsPath;
                if (!targetPath) return;

                const name = path.basename(targetPath);
                const isDir = fs.statSync(targetPath).isDirectory();
                const kind = isDir ? "carpeta" : "archivo";

                const answer = await vscode.window.showWarningMessage(
                    "Eliminar " + kind + ": " + name + "?",
                    { modal: true },
                    "Eliminar",
                );
                if (answer !== "Eliminar") return;

                if (isDir) {
                    fs.rmSync(targetPath, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(targetPath);
                }
                treeProvider.refresh();
            },
        ),
    );
}

// ─── Activate ─────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
    // LSP client
    const serverModule = context.asAbsolutePath(
        path.join("server", "dist", "server.js"),
    );
    client = new LanguageClient(
        "grailsLanguageServer",
        "Grails Language Server",
        {
            run: { module: serverModule, transport: TransportKind.ipc },
            debug: { module: serverModule, transport: TransportKind.ipc },
        } as ServerOptions,
        {
            documentSelector: [
                { scheme: "file", language: "groovy" },
                { scheme: "file", language: "gsp" },
            ],
        } as LanguageClientOptions,
    );
    client.start();

    // Project tree
    treeProvider = new GrailsProjectProvider();
    context.subscriptions.push(
        vscode.window.createTreeView("grailsProjectExplorer", {
            treeDataProvider: treeProvider,
            showCollapseAll: true,
        }),
    );

    // Auto-refresh on file changes
    const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(
            vscode.workspace.workspaceFolders?.[0] ?? "",
            "grails-app/**",
        ),
    );
    watcher.onDidCreate(() => treeProvider.refresh());
    watcher.onDidDelete(() => treeProvider.refresh());
    context.subscriptions.push(watcher);

    // GSP CodeLens
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { scheme: "file", language: "groovy" },
            new GrailsGspCodeLensProvider(),
        ),
    );

    // CLI commands
    const cli: [string, () => void][] = [
        ["grails.runApp", () => runGrailsCommand("grails run-app")],
        [
            "grails.runAppDebug",
            () => runGrailsCommand("grails run-app --debug-jvm"),
        ],
        ["grails.stopApp", () => runGrailsCommand("grails stop-app")],
        ["grails.testApp", () => runGrailsCommand("grails test-app")],
        ["grails.clean", () => runGrailsCommand("grails clean")],
        ["grails.compile", () => runGrailsCommand("grails compile")],
        ["grails.refreshTree", () => treeProvider.refresh()],
    ];
    for (const [cmd, fn] of cli) {
        context.subscriptions.push(vscode.commands.registerCommand(cmd, fn));
    }

    // Context menu commands
    registerContextCommands(context);

    // Status bar
    const root = getWorkspaceRoot();
    if (root) {
        const ver = detectGrailsVersion(root);
        const sb = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100,
        );
        sb.text = "$(package) Grails " + ver;
        sb.tooltip = "Grails — click para correr la app";
        sb.command = "grails.runApp";
        sb.show();
        context.subscriptions.push(sb);
    }
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) return undefined;
    return client.stop();
}
