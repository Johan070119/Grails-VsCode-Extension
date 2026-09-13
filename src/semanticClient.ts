import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
} from "vscode-languageclient/node";
import { discoverGradleProjectModel } from "./gradleProjectModel";
import { RestartableResources } from "./restartableResources";

export interface SemanticClientHandle {
    client: LanguageClient;
    folder: vscode.WorkspaceFolder;
}

function boundedNumber(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function abortError(): Error {
    const error = new Error("Operación cancelada");
    error.name = "AbortError";
    return error;
}

async function startWithDeadline(
    client: LanguageClient,
    timeoutMs: number,
    signal?: AbortSignal,
): Promise<void> {
    if (signal?.aborted) throw abortError();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`El servidor semántico no inició en ${timeoutMs} ms.`)),
            timeoutMs,
        );
    });
    const aborted = new Promise<never>((_, reject) => {
        if (!signal) return;
        abortListener = () => reject(abortError());
        signal.addEventListener("abort", abortListener, { once: true });
    });
    const starting = client.start();
    try {
        await Promise.race([starting, timeout, aborted]);
    } catch (error) {
        void starting.catch(() => undefined);
        throw error;
    } finally {
        if (timer) clearTimeout(timer);
        if (signal && abortListener) signal.removeEventListener("abort", abortListener);
    }
}

function resolveJavaExecutable(javaHome: string | undefined): string {
    const home = javaHome?.trim() || process.env.JAVA_HOME;
    if (!home) return "java";
    return path.join(home, "bin", process.platform === "win32" ? "java.exe" : "java");
}

function resolveJarPath(
    context: vscode.ExtensionContext,
    configuredPath: string,
): string | null {
    const candidate = configuredPath.trim()
        ? path.resolve(configuredPath.trim())
        : context.asAbsolutePath(
              path.join("semantic-server", "groovy-language-server-all.jar"),
          );
    return candidate.endsWith(".jar") && fs.existsSync(candidate)
        ? candidate
        : null;
}

export async function startSemanticClients(
    context: vscode.ExtensionContext,
    signal?: AbortSignal,
): Promise<SemanticClientHandle[]> {
    const config = vscode.workspace.getConfiguration("grails.semantic");
    if (!config.get<boolean>("enabled", false)) return [];

    if (!vscode.workspace.isTrusted) {
        vscode.window.showWarningMessage(
            "El servidor semántico Grails requiere un workspace confiable.",
        );
        return [];
    }

    const jarPath = resolveJarPath(
        context,
        config.get<string>("server.jar", ""),
    );
    if (!jarPath) {
        vscode.window.showWarningMessage(
            "No se encontró el JAR del servidor semántico. Configura grails.semantic.server.jar.",
        );
        return [];
    }

    const configuredJavaHome = config.get<string>("java.home", "").trim();
    const javaExtensionHome = vscode.workspace
        .getConfiguration("java")
        .get<string>("jdt.ls.java.home", "")
        .trim();
    const effectiveJavaHome =
        configuredJavaHome || javaExtensionHome || process.env.JAVA_HOME;
    const javaExecutable = resolveJavaExecutable(effectiveJavaHome);
    if (path.isAbsolute(javaExecutable) && !fs.existsSync(javaExecutable)) {
        vscode.window.showErrorMessage(
            `No se encontró Java en ${javaExecutable}.`,
        );
        return [];
    }

    const configuredClasspath = config.get<string[]>("classpath", []);
    const autoClasspath = config.get<boolean>("gradle.autoClasspath", true);
    const gradleTimeout = boundedNumber(config.get<number>("gradle.timeout", 120_000), 10_000, 600_000);
    const startupTimeout = boundedNumber(config.get<number>("startupTimeout", 30_000), 5_000, 120_000);
    const maxHeapMb = boundedNumber(config.get<number>("java.maxHeapMb", 1024), 256, 8192);
    const initScript = context.asAbsolutePath(
        path.join("resources", "gradle", "grails-vscode-classpath.init.gradle"),
    );
    const clients: SemanticClientHandle[] = [];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        if (signal?.aborted) break;
        if (!fs.existsSync(path.join(folder.uri.fsPath, "grails-app"))) continue;

        const serverOptions: ServerOptions = {
            command: javaExecutable,
            args: [`-Xmx${maxHeapMb}m`, "-jar", jarPath],
            options: { cwd: folder.uri.fsPath },
        };
        const clientOptions: LanguageClientOptions = {
            workspaceFolder: folder,
            documentSelector: [
                {
                    scheme: "file",
                    language: "groovy",
                    pattern: path
                        .join(folder.uri.fsPath, "**", "*.groovy")
                        .replace(/\\/g, "/"),
                },
            ],
            outputChannelName: `Grails Semantic: ${folder.name}`,
            middleware: {
                provideCompletionItem: () => [],
                provideDefinition: () => undefined,
                provideReferences: () => [],
                provideRenameEdits: () => undefined,
                prepareRename: () => undefined,
                provideHover: () => undefined,
                provideDocumentSymbols: () => [],
                provideWorkspaceSymbols: () => [],
            },
        };
        const semanticClient = new LanguageClient(
            `grailsSemantic-${folder.index}`,
            `Grails Semantic (${folder.name})`,
            serverOptions,
            clientOptions,
        );
        try {
            let discoveredClasspath: string[] = [];
            if (autoClasspath) {
                try {
                    const model = await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Window,
                            title: `Resolviendo classpath Grails: ${folder.name}`,
                        },
                        () =>
                            discoverGradleProjectModel(
                                folder.uri.fsPath,
                                initScript,
                                gradleTimeout,
                                effectiveJavaHome,
                                signal,
                            ),
                    );
                    discoveredClasspath = model
                        ? [...model.classpath, ...model.sourceRoots]
                        : [];
                } catch (error) {
                    if (signal?.aborted) break;
                    const detail = error instanceof Error ? error.message : String(error);
                    vscode.window.showWarningMessage(
                        `No se pudo resolver el classpath Gradle de ${folder.name}: ${detail}`,
                    );
                }
            }
            await startWithDeadline(semanticClient, startupTimeout, signal);
            if (signal?.aborted) throw abortError();
            const classpath = [
                ...discoveredClasspath,
                ...configuredClasspath.map((entry) =>
                    path.isAbsolute(entry)
                        ? path.normalize(entry)
                        : path.resolve(folder.uri.fsPath, entry),
                ),
            ].filter((entry, index, values) => values.indexOf(entry) === index);
            await semanticClient.sendNotification(
                "workspace/didChangeConfiguration",
                { settings: { groovy: { classpath } } },
            );
            clients.push({ client: semanticClient, folder });
        } catch (error) {
            await semanticClient.stop().catch(() => undefined);
            if (signal?.aborted) break;
            const detail = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(
                `No se pudo iniciar el servidor semántico para ${folder.name}: ${detail}`,
            );
        }
    }
    return clients;
}

export class SemanticClientManager implements vscode.Disposable {
    private restartTimer: ReturnType<typeof setTimeout> | undefined;
    private readonly resources: RestartableResources<SemanticClientHandle>;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.resources = new RestartableResources(
            (signal) => startSemanticClients(this.context, signal),
            async (handle) => handle.client.stop().catch(() => undefined),
        );
    }

    start(): Promise<void> {
        return this.resources.restart();
    }

    scheduleRestart(delayMs = 250): void {
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
            this.restartTimer = undefined;
            void this.resources.restart().catch((error) => {
                const detail = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`No se pudo reiniciar el servidor semántico: ${detail}`);
            });
        }, delayMs);
    }

    getClient(uri: vscode.Uri): LanguageClient | undefined {
        const candidate = path.resolve(uri.fsPath);
        return this.resources.getAll().find(({ folder }) => {
            const root = path.resolve(folder.uri.fsPath);
            const relative = path.relative(root, candidate);
            return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
        })?.client;
    }

    getClients(): readonly LanguageClient[] {
        return this.resources.getAll().map(({ client }) => client);
    }

    async dispose(): Promise<void> {
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = undefined;
        await this.resources.dispose();
    }
}
