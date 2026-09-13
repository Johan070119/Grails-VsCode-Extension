import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const execFile = promisify(childProcess.execFile);
const MODEL_MARKER = "GRAILS_VSCODE_MODEL:";

export interface GradleProjectModel {
    classpath: string[];
    sourceRoots: string[];
}

export function parseGradleProjectModel(output: string): GradleProjectModel | null {
    const line = output
        .split(/\r?\n/)
        .find((candidate) => candidate.startsWith(MODEL_MARKER));
    if (!line) return null;
    try {
        const value = JSON.parse(line.slice(MODEL_MARKER.length)) as Partial<GradleProjectModel>;
        if (!Array.isArray(value.classpath) || !Array.isArray(value.sourceRoots))
            return null;
        return {
            classpath: [...new Set(value.classpath.filter((entry): entry is string => typeof entry === "string"))],
            sourceRoots: [...new Set(value.sourceRoots.filter((entry): entry is string => typeof entry === "string"))],
        };
    } catch {
        return null;
    }
}

function windowsCommandLine(executable: string, args: string[]): string {
    const quote = (value: string) =>
        `"${value.replace(/%/g, "%%").replace(/["^&|<>]/g, "^$&")}"`;
    return [executable, ...args].map(quote).join(" ");
}

/**
 * Runs only the project-owned Gradle Wrapper. Callers must enforce Workspace
 * Trust before invoking this function because Gradle evaluates project code.
 */
export async function discoverGradleProjectModel(
    projectRoot: string,
    initScript: string,
    timeoutMs = 120_000,
    javaHome?: string,
    signal?: AbortSignal,
): Promise<GradleProjectModel | null> {
    const windows = process.platform === "win32";
    const wrapper = path.join(projectRoot, windows ? "gradlew.bat" : "gradlew");
    if (!fs.existsSync(wrapper) || !fs.existsSync(initScript)) return null;

    const gradleArgs = [
        "--init-script",
        initScript,
        "grailsVscodeClasspath",
        "--quiet",
        "--console=plain",
    ];
    const command = windows ? process.env.ComSpec || "cmd.exe" : wrapper;
    const args = windows
        ? ["/d", "/v:off", "/s", "/c", windowsCommandLine(wrapper, gradleArgs)]
        : gradleArgs;
    const { stdout } = await execFile(command, args, {
        cwd: projectRoot,
        env: javaHome?.trim()
            ? { ...process.env, JAVA_HOME: javaHome.trim() }
            : process.env,
        timeout: timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true,
        signal,
    });
    return parseGradleProjectModel(stdout);
}
