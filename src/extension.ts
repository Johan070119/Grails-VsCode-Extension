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

// ─── Grails Project Tree ──────────────────────────────────────────────────────

/**
 * Represents a node in the Grails project tree.
 * Mirrors IntelliJ's project view: shows only meaningful Grails folders
 * instead of the raw filesystem dump that VS Code's default explorer shows.
 */
interface GrailsNode {
    label: string;
    fsPath: string;
    kind: "root-group" | "folder" | "file";
    iconId: string;
    children?: GrailsNode[];
}

class GrailsTreeItem extends vscode.TreeItem {
    constructor(
        public readonly node: GrailsNode,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    ) {
        super(node.label, collapsibleState);
        this.resourceUri = vscode.Uri.file(node.fsPath);
        this.iconPath = new vscode.ThemeIcon(node.iconId);

        if (node.kind === "file") {
            this.command = {
                command: "vscode.open",
                title: "Open file",
                arguments: [vscode.Uri.file(node.fsPath)],
            };
            this.contextValue = "grailsFile";
        } else {
            this.contextValue = "grailsFolder";
        }
    }
}

class GrailsProjectProvider implements vscode.TreeDataProvider<GrailsTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<
        GrailsTreeItem | undefined
    >();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private root: string | null = null;

    constructor() {
        // Watch for workspace folder changes
        vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh());
        this.detectRoot();
    }

    refresh(): void {
        this.detectRoot();
        this._onDidChangeTreeData.fire(undefined);
    }

    private detectRoot(): void {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            this.root = null;
            return;
        }

        for (const folder of folders) {
            const p = folder.uri.fsPath;
            if (fs.existsSync(path.join(p, "grails-app"))) {
                this.root = p;
                return;
            }
        }
        this.root = null;
    }

    getTreeItem(element: GrailsTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: GrailsTreeItem): GrailsTreeItem[] {
        if (!this.root) return [];

        // Top level — the fixed "groups" that mirror IntelliJ's project view
        if (!element) {
            return this.buildTopLevel(this.root);
        }

        // Children of a folder node
        if (
            element.node.kind === "folder" ||
            element.node.kind === "root-group"
        ) {
            return this.buildFolderChildren(element.node.fsPath);
        }

        return [];
    }

    // ── Top-level structure ───────────────────────────────────────────────────
    // Mirrors IntelliJ Grails project view exactly:
    //   grails-app
    //     ├─ controllers
    //     ├─ domain
    //     ├─ services
    //     ├─ views
    //     ├─ conf
    //     ├─ i18n
    //     ├─ taglib
    //     └─ utils
    //   src
    //     ├─ main/groovy
    //     └─ main/resources
    //   web-app (or src/main/webapp)
    //   test

    private buildTopLevel(root: string): GrailsTreeItem[] {
        const items: GrailsTreeItem[] = [];

        // ── grails-app ───────────────────────────────────────────────────────
        const grailsAppGroups: Array<{
            label: string;
            rel: string;
            icon: string;
        }> = [
            {
                label: "controllers",
                rel: "grails-app/controllers",
                icon: "symbol-class",
            },
            { label: "domain", rel: "grails-app/domain", icon: "database" },
            {
                label: "services",
                rel: "grails-app/services",
                icon: "symbol-interface",
            },
            { label: "views", rel: "grails-app/views", icon: "file-code" },
            { label: "conf", rel: "grails-app/conf", icon: "settings-gear" },
            { label: "i18n", rel: "grails-app/i18n", icon: "globe" },
            { label: "taglib", rel: "grails-app/taglib", icon: "tag" },
            { label: "utils", rel: "grails-app/utils", icon: "tools" },
        ];

        const grailsAppChildren: GrailsTreeItem[] = [];
        for (const g of grailsAppGroups) {
            const fullPath = path.join(root, g.rel);
            if (!fs.existsSync(fullPath)) continue;
            grailsAppChildren.push(
                this.makeFolder(g.label, fullPath, g.icon, "folder"),
            );
        }

        if (grailsAppChildren.length > 0) {
            const grailsAppItem = new GrailsTreeItem(
                {
                    label: "grails-app",
                    fsPath: path.join(root, "grails-app"),
                    kind: "root-group",
                    iconId: "package",
                },
                vscode.TreeItemCollapsibleState.Expanded,
            );
            // Inject children so getChildren() works via folder listing
            items.push(grailsAppItem);
        }

        // ── src ──────────────────────────────────────────────────────────────
        const srcGroups = [
            {
                label: "main/groovy",
                rel: "src/main/groovy",
                icon: "symbol-method",
            },
            {
                label: "main/resources",
                rel: "src/main/resources",
                icon: "file-binary",
            },
            { label: "test/groovy", rel: "src/test/groovy", icon: "beaker" },
        ];
        for (const g of srcGroups) {
            const fullPath = path.join(root, g.rel);
            if (!fs.existsSync(fullPath)) continue;
            items.push(this.makeFolder(g.label, fullPath, g.icon, "folder"));
        }

        // ── web-app (Grails 2/3 style) ────────────────────────────────────
        const webApp = path.join(root, "web-app");
        if (fs.existsSync(webApp)) {
            items.push(this.makeFolder("web-app", webApp, "browser", "folder"));
        }
        // Grails 3+ style
        const webapp = path.join(root, "src/main/webapp");
        if (fs.existsSync(webapp)) {
            items.push(this.makeFolder("webapp", webapp, "browser", "folder"));
        }

        // ── test ─────────────────────────────────────────────────────────────
        const testDir = path.join(root, "test");
        if (fs.existsSync(testDir)) {
            items.push(this.makeFolder("test", testDir, "beaker", "folder"));
        }

        return items;
    }

    // ── Folder children ───────────────────────────────────────────────────────

    private buildFolderChildren(folderPath: string): GrailsTreeItem[] {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(folderPath, { withFileTypes: true });
        } catch {
            return [];
        }

        const folders: GrailsTreeItem[] = [];
        const files: GrailsTreeItem[] = [];

        for (const entry of entries) {
            // Skip hidden files and build artifacts
            if (entry.name.startsWith(".")) continue;
            if (
                entry.name === "node_modules" ||
                entry.name === "build" ||
                entry.name === ".gradle"
            )
                continue;

            const fullPath = path.join(folderPath, entry.name);

            if (entry.isDirectory()) {
                folders.push(
                    this.makeFolder(entry.name, fullPath, "folder", "folder"),
                );
            } else {
                files.push(this.makeFile(entry.name, fullPath));
            }
        }

        // Folders first, then files — same as IntelliJ
        return [...folders, ...files];
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private makeFolder(
        label: string,
        fsPath: string,
        iconId: string,
        kind: GrailsNode["kind"],
    ): GrailsTreeItem {
        return new GrailsTreeItem(
            { label, fsPath, kind, iconId },
            vscode.TreeItemCollapsibleState.Collapsed,
        );
    }

    private makeFile(label: string, fsPath: string): GrailsTreeItem {
        const icon = this.iconForFile(label);
        return new GrailsTreeItem(
            { label, fsPath, kind: "file", iconId: icon },
            vscode.TreeItemCollapsibleState.None,
        );
    }

    private iconForFile(name: string): string {
        if (name.endsWith(".groovy")) return "symbol-class";
        if (name.endsWith(".gsp")) return "file-code";
        if (name.endsWith(".yml") || name.endsWith(".yaml")) return "settings";
        if (name.endsWith(".xml")) return "file-code";
        if (name.endsWith(".properties")) return "list-unordered";
        if (name.endsWith(".java")) return "symbol-class";
        if (name.endsWith(".sql")) return "database";
        return "file";
    }
}

// ─── Grails CLI commands ──────────────────────────────────────────────────────

/**
 * Runs a Grails CLI command in the integrated terminal.
 * Reuses an existing "Grails" terminal if available.
 */
function runGrailsCommand(command: string): void {
    const terminals = vscode.window.terminals;
    let terminal = terminals.find((t) => t.name === "Grails");
    if (!terminal) {
        terminal = vscode.window.createTerminal({ name: "Grails" });
    }
    terminal.show();
    terminal.sendText(command);
}

function registerCliCommands(context: vscode.ExtensionContext): void {
    // grails run-app
    context.subscriptions.push(
        vscode.commands.registerCommand("grails.runApp", () => {
            runGrailsCommand("grails run-app");
        }),
    );

    // grails run-app --debug
    context.subscriptions.push(
        vscode.commands.registerCommand("grails.runAppDebug", () => {
            runGrailsCommand("grails run-app --debug-jvm");
        }),
    );

    // grails stop-app
    context.subscriptions.push(
        vscode.commands.registerCommand("grails.stopApp", () => {
            runGrailsCommand("grails stop-app");
        }),
    );

    // grails test-app
    context.subscriptions.push(
        vscode.commands.registerCommand("grails.testApp", () => {
            runGrailsCommand("grails test-app");
        }),
    );

    // grails create-controller (asks for name)
    context.subscriptions.push(
        vscode.commands.registerCommand("grails.createController", async () => {
            const name = await vscode.window.showInputBox({
                prompt: "Controller name (e.g. Book)",
                placeHolder: "Book",
            });
            if (name) runGrailsCommand(`grails create-controller ${name}`);
        }),
    );

    // grails create-domain-class
    context.subscriptions.push(
        vscode.commands.registerCommand("grails.createDomain", async () => {
            const name = await vscode.window.showInputBox({
                prompt: "Domain class name (e.g. Book)",
                placeHolder: "Book",
            });
            if (name) runGrailsCommand(`grails create-domain-class ${name}`);
        }),
    );

    // grails create-service
    context.subscriptions.push(
        vscode.commands.registerCommand("grails.createService", async () => {
            const name = await vscode.window.showInputBox({
                prompt: "Service name (e.g. Book)",
                placeHolder: "Book",
            });
            if (name) runGrailsCommand(`grails create-service ${name}`);
        }),
    );

    // grails generate-all (scaffold)
    context.subscriptions.push(
        vscode.commands.registerCommand("grails.generateAll", async () => {
            const name = await vscode.window.showInputBox({
                prompt: "Domain class to scaffold (e.g. com.example.Book)",
                placeHolder: "Book",
            });
            if (name) runGrailsCommand(`grails generate-all ${name}`);
        }),
    );

    // grails clean
    context.subscriptions.push(
        vscode.commands.registerCommand("grails.clean", () => {
            runGrailsCommand("grails clean");
        }),
    );

    // Refresh tree view
    context.subscriptions.push(
        vscode.commands.registerCommand("grails.refreshTree", () => {
            treeProvider.refresh();
        }),
    );
}

// ─── Tree provider instance (needs to be accessible from commands) ────────────
let treeProvider: GrailsProjectProvider;

// ─── Extension activate ───────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
    // ── LSP client ────────────────────────────────────────────────────────────
    const serverModule = context.asAbsolutePath(
        path.join("server", "dist", "server.js"),
    );
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: { module: serverModule, transport: TransportKind.ipc },
    };
    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { scheme: "file", language: "groovy" },
            { scheme: "file", language: "gsp" },
        ],
    };
    client = new LanguageClient(
        "grailsLanguageServer",
        "Grails Language Server",
        serverOptions,
        clientOptions,
    );
    client.start();

    // ── Project tree view ─────────────────────────────────────────────────────
    treeProvider = new GrailsProjectProvider();
    const treeView = vscode.window.createTreeView("grailsProjectExplorer", {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(treeView);

    // Auto-refresh when files change inside grails-app
    const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(
            vscode.workspace.workspaceFolders?.[0] ?? "",
            "grails-app/**",
        ),
    );
    watcher.onDidCreate(() => treeProvider.refresh());
    watcher.onDidDelete(() => treeProvider.refresh());
    context.subscriptions.push(watcher);

    // ── CLI commands ──────────────────────────────────────────────────────────
    registerCliCommands(context);
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) return undefined;
    return client.stop();
}
