import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
} from "vscode-languageclient/node";
import { discoverGradleProjectModel } from "./gradleProjectModel";

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
): Promise<LanguageClient[]> {
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
    const gradleTimeout = config.get<number>("gradle.timeout", 120_000);
    const initScript = context.asAbsolutePath(
        path.join("resources", "gradle", "grails-vscode-classpath.init.gradle"),
    );
    const clients: LanguageClient[] = [];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        if (!fs.existsSync(path.join(folder.uri.fsPath, "grails-app"))) continue;

        const serverOptions: ServerOptions = {
            command: javaExecutable,
            args: ["-jar", jarPath],
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
                            ),
                    );
                    discoveredClasspath = model
                        ? [...model.classpath, ...model.sourceRoots]
                        : [];
                } catch (error) {
                    const detail = error instanceof Error ? error.message : String(error);
                    vscode.window.showWarningMessage(
                        `No se pudo resolver el classpath Gradle de ${folder.name}: ${detail}`,
                    );
                }
            }
            await semanticClient.start();
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
            clients.push(semanticClient);
        } catch (error) {
            await semanticClient.stop().catch(() => undefined);
            const detail = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(
                `No se pudo iniciar el servidor semántico para ${folder.name}: ${detail}`,
            );
        }
    }
    return clients;
}
