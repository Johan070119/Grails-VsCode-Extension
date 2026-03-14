//server/src/indexer.ts
import * as fs from "fs";
import * as path from "path";
import { Connection } from "vscode-languageserver/node";
import {
    GrailsProject,
    buildGrailsProject,
    findGrailsRoot,
    isGrailsProject,
} from "./grailsProject";

export class GrailsIndexer {
    private project: GrailsProject | null = null;
    private watchers: fs.FSWatcher[] = [];
    private connection: Connection;
    private rebuildTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(connection: Connection) {
        this.connection = connection;
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    /** Call once on initialize with the workspace root folders */
    initialize(workspaceFolders: string[]): void {
        for (const folder of workspaceFolders) {
            const root = isGrailsProject(folder)
                ? folder
                : findGrailsRoot(folder);
            if (root) {
                this.connection.console.log(
                    `[Grails] Project found at: ${root}`,
                );
                this.index(root);
                this.watchProject(root);
                return; // single project per workspace for now
            }
        }
        this.connection.console.log(
            "[Grails] No Grails project found in workspace.",
        );
    }

    /** Re-index when a file changes (called from onDidChangeWatchedFiles) */
    onFileChanged(changedPath: string): void {
        if (!this.project) return;
        if (!changedPath.endsWith(".groovy")) return;

        // Debounce: wait 300ms after last change before rebuilding
        if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
        this.rebuildTimer = setTimeout(() => {
            this.connection.console.log(
                `[Grails] Re-indexing after change: ${path.basename(changedPath)}`,
            );
            this.index(this.project!.root);
        }, 300);
    }

    getProject(): GrailsProject | null {
        return this.project;
    }

    dispose(): void {
        for (const w of this.watchers) {
            try {
                w.close();
            } catch {}
        }
        this.watchers = [];
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    private index(root: string): void {
        try {
            this.project = buildGrailsProject(root);
            this.logStats();
        } catch (e) {
            this.connection.console.error(`[Grails] Indexing error: ${e}`);
        }
    }

    private logStats(): void {
        if (!this.project) return;
        const { domains, controllers, services, taglibs } = this.project;
        this.connection.console.log(
            `[Grails] Index complete — ` +
                `${domains.size} domains, ${controllers.size} controllers, ` +
                `${services.size} services, ${taglibs.size} taglibs`,
        );
    }

    /** Watch grails-app subdirs for .groovy changes */
    private watchProject(root: string): void {
        const dirsToWatch = [
            "grails-app/domain",
            "grails-app/controllers",
            "grails-app/services",
            "grails-app/taglib",
        ];

        for (const rel of dirsToWatch) {
            const dir = path.join(root, rel);
            if (!fs.existsSync(dir)) continue;
            try {
                const watcher = fs.watch(
                    dir,
                    { recursive: true },
                    (_event, filename) => {
                        if (filename?.endsWith(".groovy")) {
                            this.onFileChanged(path.join(dir, filename));
                        }
                    },
                );
                this.watchers.push(watcher);
            } catch {
                // fs.watch not available on all platforms — silent fail
            }
        }
    }
}
