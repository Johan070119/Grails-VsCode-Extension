import * as fs from "fs";
import * as path from "path";

export type GrailsCommandKind =
    | "runApp"
    | "runAppDebug"
    | "stopApp"
    | "testApp"
    | "clean"
    | "compile";

export interface ResolvedGrailsCommand {
    executable: string;
    args: string[];
    source: "grails-wrapper" | "gradle-wrapper" | "system-grails";
}

const grailsArguments: Record<GrailsCommandKind, string[]> = {
    runApp: ["run-app"],
    runAppDebug: ["run-app", "--debug-jvm"],
    stopApp: ["stop-app"],
    testApp: ["test-app"],
    clean: ["clean"],
    compile: ["compile"],
};

const gradleArguments: Partial<Record<GrailsCommandKind, string[]>> = {
    runApp: ["bootRun"],
    runAppDebug: ["bootRun", "--debug-jvm"],
    testApp: ["test"],
    clean: ["clean"],
    compile: ["classes"],
};

export function resolveGrailsCommand(
    root: string,
    kind: GrailsCommandKind,
    platform: NodeJS.Platform = process.platform,
): ResolvedGrailsCommand {
    const windows = platform === "win32";
    const grailsWrapperName = windows ? "grailsw.bat" : "grailsw";
    if (fs.existsSync(path.join(root, grailsWrapperName))) {
        return {
            executable: windows ? `.\\${grailsWrapperName}` : `./${grailsWrapperName}`,
            args: grailsArguments[kind],
            source: "grails-wrapper",
        };
    }

    const gradleWrapperName = windows ? "gradlew.bat" : "gradlew";
    const gradleArgs = gradleArguments[kind];
    if (gradleArgs && fs.existsSync(path.join(root, gradleWrapperName))) {
        return {
            executable: windows ? `.\\${gradleWrapperName}` : `./${gradleWrapperName}`,
            args: gradleArgs,
            source: "gradle-wrapper",
        };
    }

    return {
        executable: "grails",
        args: grailsArguments[kind],
        source: "system-grails",
    };
}

export function quoteTerminalArgument(
    value: string,
    platform: NodeJS.Platform = process.platform,
): string {
    if (/^[A-Za-z0-9_./:@=+,-]+$/.test(value)) return value;
    if (platform === "win32") return `"${value.replace(/"/g, '""')}"`;
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}
