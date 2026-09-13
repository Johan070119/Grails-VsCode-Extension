import * as fs from "fs";
import * as path from "path";
import { Connection } from "vscode-languageserver/node";
import {
    GrailsProject,
    buildGrailsProject,
    clearOpenFileContent,
    findGrailsRoot,
    isGrailsProject,
    setOpenFileContent,
    updateGrailsProjectFile,
} from "./grailsProject";

export class GrailsIndexer {
    private projects = new Map<string, GrailsProject>();
    private watchers = new Map<string, fs.FSWatcher[]>();
    private connection: Connection;
    private rebuildTimers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(connection: Connection) {
        this.connection = connection;
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    initialize(workspaceFolders: string[]): void {
        for (const folder of workspaceFolders) {
            const root = isGrailsProject(folder)
                ? folder
                : findGrailsRoot(folder);
            if (root) {
                this.addProject(root);
            }
        }
        if (this.projects.size === 0)
            this.connection.console.log(
                "[Grails] No Grails project found in workspace.",
            );
    }

    addWorkspaceFolder(folder: string): void {
        const root = isGrailsProject(folder) ? folder : findGrailsRoot(folder);
        if (root) this.addProject(root);
    }

    removeWorkspaceFolder(folder: string): void {
        const normalizedFolder = path.resolve(folder);
        for (const root of [...this.projects.keys()]) {
            if (root === normalizedFolder || this.isInside(root, normalizedFolder)) {
                const timer = this.rebuildTimers.get(root);
                if (timer) clearTimeout(timer);
                this.rebuildTimers.delete(root);
                this.closeWatchers(root);
                this.projects.delete(root);
            }
        }
    }

    onFileChanged(changedPath: string): void {
        const project = this.getProject(changedPath);
        if (!project) return;
        if (!this.isRelevantProjectFile(changedPath)) return;

        const existingTimer = this.rebuildTimers.get(project.root);
        if (existingTimer) clearTimeout(existingTimer);
        const timer = setTimeout(() => {
            this.connection.console.log(
                `[Grails] Re-indexing after change: ${path.basename(changedPath)}`,
            );
            if (this.requiresFullRebuild(changedPath)) {
                this.index(project.root);
                this.closeWatchers(project.root);
                this.watchProject(project.root);
            } else {
                updateGrailsProjectFile(project, changedPath);
                this.logStats(project);
            }
            this.rebuildTimers.delete(project.root);
        }, 300);
        this.rebuildTimers.set(project.root, timer);
    }

    onOpenDocumentChanged(filePath: string, content: string): void {
        setOpenFileContent(filePath, content);
        const project = this.getProject(filePath);
        if (project && /\.(?:groovy|java)$/.test(filePath))
            updateGrailsProjectFile(project, filePath);
    }

    onOpenDocumentClosed(filePath: string): void {
        clearOpenFileContent(filePath);
        const project = this.getProject(filePath);
        if (project && /\.(?:groovy|java)$/.test(filePath))
            updateGrailsProjectFile(project, filePath);
    }

    getProject(documentPath?: string): GrailsProject | null {
        if (!documentPath) return this.projects.values().next().value ?? null;
        const normalizedDocument = path.resolve(documentPath);
        let bestMatch: GrailsProject | null = null;
        for (const project of this.projects.values()) {
            if (!this.isInside(normalizedDocument, project.root)) continue;
            if (!bestMatch || project.root.length > bestMatch.root.length)
                bestMatch = project;
        }
        return bestMatch;
    }

    getProjects(): GrailsProject[] {
        return [...this.projects.values()];
    }

    dispose(): void {
        for (const root of this.watchers.keys()) this.closeWatchers(root);
        for (const timer of this.rebuildTimers.values()) clearTimeout(timer);
        this.rebuildTimers.clear();
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    private index(root: string): void {
        try {
            const project = buildGrailsProject(root);
            this.projects.set(project.root, project);
            this.logStats(project);
        } catch (e) {
            this.connection.console.error(`[Grails] Indexing error: ${e}`);
        }
    }

    private logStats(project: GrailsProject): void {
        const { domains, controllers, services, taglibs, version } =
            project;
        this.connection.console.log(
            `[Grails] Indexed ${project.root} (v${project.versionInfo.raw ?? version}) — ` +
                `${domains.size} domains, ${controllers.size} controllers, ` +
                `${services.size} services, ${taglibs.size} taglibs, ` +
                `${project.sourceClasses.size} source classes`,
        );
    }

    private addProject(root: string): void {
        const normalizedRoot = path.resolve(root);
        if (this.projects.has(normalizedRoot)) return;
        this.connection.console.log(
            `[Grails] Project found at: ${normalizedRoot}`,
        );
        this.index(normalizedRoot);
        this.watchProject(normalizedRoot);
    }

    private isInside(candidate: string, root: string): boolean {
        const relative = path.relative(root, candidate);
        return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    }

    private isRelevantProjectFile(filePath: string): boolean {
        const fileName = path.basename(filePath);
        return (
            /\.(groovy|java|gsp|yml|yaml|properties)$/.test(fileName) ||
            [
                "build.gradle",
                "build.gradle.kts",
                "settings.gradle",
                "settings.gradle.kts",
                "gradle.properties",
            ].includes(fileName)
        );
    }

    private requiresFullRebuild(filePath: string): boolean {
        return [
            "build.gradle",
            "build.gradle.kts",
            "settings.gradle",
            "settings.gradle.kts",
            "gradle.properties",
            "application.properties",
        ].includes(path.basename(filePath));
    }

    private closeWatchers(root: string): void {
        for (const watcher of this.watchers.get(root) ?? []) {
            try {
                watcher.close();
            } catch {}
        }
        this.watchers.delete(root);
    }

    /** Watches every discovered source root plus root-level build metadata. */
    private watchProject(root: string): void {
        const project = this.projects.get(root);
        const dirsToWatch = project?.sourceRoots ?? [];

        const projectWatchers: fs.FSWatcher[] = [];
        for (const dir of dirsToWatch) {
            if (!fs.existsSync(dir)) continue;
            try {
                const watcher = fs.watch(
                    dir,
                    { recursive: true },
                    (_event, filename) => {
                        if (filename && this.isRelevantProjectFile(filename)) {
                            this.onFileChanged(path.join(dir, filename));
                        }
                    },
                );
                projectWatchers.push(watcher);
            } catch {
                // fs.watch with recursive:true not supported on all platforms
                // (notably Linux requires inotify). Fail silently.
            }
        }
        try {
            const rootWatcher = fs.watch(root, (_event, filename) => {
                if (filename && this.isRelevantProjectFile(filename))
                    this.onFileChanged(path.join(root, filename));
            });
            projectWatchers.push(rootWatcher);
        } catch {
            // The editor's watched-file notifications remain as a fallback.
        }
        this.watchers.set(root, projectWatchers);
    }
}
