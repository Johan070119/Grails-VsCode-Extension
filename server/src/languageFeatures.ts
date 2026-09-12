import * as path from "path";
import {
    Hover,
    MarkupKind,
    Position,
    Range,
    SymbolInformation,
    SymbolKind,
    TextDocumentPositionParams,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { GrailsProject, SourceClass, SourceMember } from "./grailsProject";
import { pathToUri, uriToPath } from "./uriUtils";

function wordAtPosition(
    document: TextDocument,
    position: Position,
): string {
    const line = document.getText().split("\n")[position.line] ?? "";
    let start = Math.min(position.character, line.length);
    let end = start;
    while (start > 0 && /[\w$]/.test(line[start - 1])) start--;
    while (end < line.length && /[\w$]/.test(line[end])) end++;
    return line.slice(start, end);
}

function sourceClassForDocument(
    document: TextDocument,
    project: GrailsProject,
): SourceClass | null {
    const filePath = path.resolve(uriToPath(document.uri));
    return (
        [...project.sourceClasses.values()].find(
            (sourceClass) => path.resolve(sourceClass.filePath) === filePath,
        ) ?? null
    );
}

function symbolKind(sourceClass: SourceClass): SymbolKind {
    switch (sourceClass.declarationKind) {
        case "interface":
            return SymbolKind.Interface;
        case "enum":
            return SymbolKind.Enum;
        case "record":
            return SymbolKind.Struct;
        default:
            return SymbolKind.Class;
    }
}

function memberSymbolKind(member: SourceMember): SymbolKind {
    return member.kind === "method" ? SymbolKind.Method : SymbolKind.Property;
}

function symbolInformation(
    name: string,
    kind: SymbolKind,
    filePath: string,
    line: number,
    containerName?: string,
): SymbolInformation {
    return SymbolInformation.create(
        name,
        kind,
        Range.create(Position.create(line, 0), Position.create(line, 0)),
        pathToUri(filePath),
        containerName,
    );
}

export function getHover(
    document: TextDocument,
    params: TextDocumentPositionParams,
    project: GrailsProject | null,
): Hover | null {
    if (!project) return null;
    const word = wordAtPosition(document, params.position);
    if (!word) return null;

    const domain = project.domains.get(word);
    if (domain) {
        const properties = domain.properties
            .slice(0, 20)
            .map((property) => `- \`${property.type} ${property.name}\``)
            .join("\n");
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: `**Grails domain** \`${domain.qualifiedName}\`\n\n${properties}`,
            },
        };
    }

    const candidates = project.sourceClassesBySimpleName.get(word) ?? [];
    if (candidates.length > 0) {
        const descriptions = candidates
            .slice(0, 5)
            .map(
                (candidate) =>
                    `- \`${candidate.qualifiedName}\` (${candidate.language} ${candidate.declarationKind})`,
            )
            .join("\n");
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: `**Project type**\n\n${descriptions}`,
            },
        };
    }

    const sourceClass = sourceClassForDocument(document, project);
    const member = sourceClass?.members.find((candidate) => candidate.name === word);
    if (!sourceClass || !member) return null;
    return {
        contents: {
            kind: MarkupKind.Markdown,
            value: `**${member.kind}** \`${member.type ? `${member.type} ` : ""}${member.name}\`\n\nDeclared in \`${sourceClass.qualifiedName}\`.`,
        },
    };
}

export function getDocumentSymbols(
    document: TextDocument,
    project: GrailsProject | null,
): SymbolInformation[] {
    if (!project) return [];
    const sourceClass = sourceClassForDocument(document, project);
    if (!sourceClass) return [];

    const containerName = sourceClass.qualifiedName;
    return [
        symbolInformation(
            sourceClass.name,
            symbolKind(sourceClass),
            sourceClass.filePath,
            sourceClass.line,
        ),
        ...sourceClass.members.map((member) =>
            symbolInformation(
                member.name,
                memberSymbolKind(member),
                sourceClass.filePath,
                member.line,
                containerName,
            ),
        ),
    ];
}

export function getWorkspaceSymbols(
    query: string,
    projects: GrailsProject[],
): SymbolInformation[] {
    const normalizedQuery = query.toLowerCase();
    const results: SymbolInformation[] = [];
    for (const project of projects) {
        for (const sourceClass of project.sourceClasses.values()) {
            if (
                normalizedQuery &&
                !sourceClass.qualifiedName.toLowerCase().includes(normalizedQuery)
            )
                continue;
            results.push(
                symbolInformation(
                    sourceClass.name,
                    symbolKind(sourceClass),
                    sourceClass.filePath,
                    sourceClass.line,
                    sourceClass.packageName || undefined,
                ),
            );
        }
    }
    return results.slice(0, 500);
}
