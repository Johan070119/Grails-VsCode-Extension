import {
    createConnection,
    ProposedFeatures,
    TextDocuments,
    TextDocumentSyncKind,
    InitializeParams,
    InitializeResult,
    CompletionItem,
    TextDocumentPositionParams,
    DidChangeWatchedFilesParams,
    Location,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { GrailsIndexer } from "./indexer";
import { getCompletions } from "./completion";
import { getDefinition } from "./definition";
import {
    getDocumentSymbols,
    getHover,
    getWorkspaceSymbols,
} from "./languageFeatures";
import { uriToPath } from "./uriUtils";
import { getGspDiagnostics } from "./gspFeatures";
import {
    getCodeLenses,
    getReferences,
    getRenameEdit,
    incomingCalls,
    outgoingCalls,
    prepareCallHierarchy,
    prepareRename,
} from "./navigationFeatures";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const indexer = new GrailsIndexer(connection);
let supportsWorkspaceFolderEvents = false;

// ─── Initialize ───────────────────────────────────────────────────────────────

connection.onInitialize((params: InitializeParams): InitializeResult => {
    supportsWorkspaceFolderEvents = params.capabilities.workspace?.workspaceFolders === true;
    const folders = params.workspaceFolders?.map((f) => uriToPath(f.uri)) ?? [];

    if (folders.length > 0) {
        indexer.initialize(folders);
    } else if (params.rootUri) {
        indexer.initialize([uriToPath(params.rootUri)]);
    } else if (params.rootPath) {
        indexer.initialize([params.rootPath]);
    }

    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: {
                resolveProvider: false,
                // Trigger on structural chars + uppercase letters (for domain/class names)
                // Uppercase letters trigger completion for "def x = Fu" → Fusion, etc.
                triggerCharacters: [
                    ".",
                    "(",
                    ":",
                    "<",
                    " ",
                    "=",
                    "\"",
                    "'",
                    "/",
                    "A",
                    "B",
                    "C",
                    "D",
                    "E",
                    "F",
                    "G",
                    "H",
                    "I",
                    "J",
                    "K",
                    "L",
                    "M",
                    "N",
                    "O",
                    "P",
                    "Q",
                    "R",
                    "S",
                    "T",
                    "U",
                    "V",
                    "W",
                    "X",
                    "Y",
                    "Z",
                ],
            },
            definitionProvider: true,
            referencesProvider: true,
            renameProvider: { prepareProvider: true },
            callHierarchyProvider: true,
            codeLensProvider: { resolveProvider: false },
            hoverProvider: true,
            documentSymbolProvider: true,
            workspaceSymbolProvider: true,
            workspace: {
                workspaceFolders: { supported: true },
            },
        },
        serverInfo: {
            name: "Grails Language Server",
            version: "0.7.0",
        },
    };
});

// ─── Completions ──────────────────────────────────────────────────────────────

connection.onCompletion(
    (params: TextDocumentPositionParams): CompletionItem[] => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return [];

        const project = indexer.getProject(uriToPath(params.textDocument.uri));
        return getCompletions(doc, params, project);
    },
);

// ─── Go to Definition ─────────────────────────────────────────────────────────

connection.onDefinition(
    (params: TextDocumentPositionParams): Location | null => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return null;
        return getDefinition(
            doc,
            params,
            indexer.getProject(uriToPath(params.textDocument.uri)),
        );
    },
);

connection.onReferences((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    return getReferences(
        doc,
        params,
        indexer.getProject(uriToPath(params.textDocument.uri)),
        params.context.includeDeclaration,
    );
});

connection.onPrepareRename((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    return prepareRename(doc, params, indexer.getProject(uriToPath(params.textDocument.uri)));
});

connection.onRenameRequest((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    return getRenameEdit(doc, params, indexer.getProject(uriToPath(params.textDocument.uri)));
});

connection.languages.callHierarchy.onPrepare((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    return prepareCallHierarchy(doc, params, indexer.getProject(uriToPath(params.textDocument.uri)));
});

connection.languages.callHierarchy.onIncomingCalls((params) => {
    const root = (params.item.data as { root?: string } | undefined)?.root;
    const project = indexer.getProjects().find((candidate) => candidate.root === root) ?? null;
    return incomingCalls(params.item, project);
});

connection.languages.callHierarchy.onOutgoingCalls((params) => {
    const root = (params.item.data as { root?: string } | undefined)?.root;
    const project = indexer.getProjects().find((candidate) => candidate.root === root) ?? null;
    return outgoingCalls(params.item, project);
});

connection.onCodeLens((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    return getCodeLenses(doc, indexer.getProject(uriToPath(params.textDocument.uri)));
});

connection.onHover((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    return getHover(
        doc,
        params,
        indexer.getProject(uriToPath(params.textDocument.uri)),
    );
});

connection.onDocumentSymbol((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    return getDocumentSymbols(
        doc,
        indexer.getProject(uriToPath(params.textDocument.uri)),
    );
});

connection.onWorkspaceSymbol((params) =>
    getWorkspaceSymbols(params.query, indexer.getProjects()),
);

function publishDocumentDiagnostics(document: TextDocument): void {
    const project = indexer.getProject(uriToPath(document.uri));
    connection.sendDiagnostics({
        uri: document.uri,
        diagnostics: getGspDiagnostics(document, project),
    });
}

documents.onDidOpen((event) => {
    indexer.onOpenDocumentChanged(uriToPath(event.document.uri), event.document.getText());
    publishDocumentDiagnostics(event.document);
});
documents.onDidChangeContent((event) => {
    indexer.onOpenDocumentChanged(uriToPath(event.document.uri), event.document.getText());
    publishDocumentDiagnostics(event.document);
});
documents.onDidClose((event) => {
    indexer.onOpenDocumentClosed(uriToPath(event.document.uri));
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

// ─── File watching ────────────────────────────────────────────────────────────

connection.onDidChangeWatchedFiles((params: DidChangeWatchedFilesParams) => {
    for (const change of params.changes) {
        indexer.onFileChanged(uriToPath(change.uri));
    }
});

connection.onInitialized(() => {
    if (!supportsWorkspaceFolderEvents) return;
    connection.workspace.onDidChangeWorkspaceFolders((params) => {
        for (const folder of params.removed)
            indexer.removeWorkspaceFolder(uriToPath(folder.uri));
        for (const folder of params.added)
            indexer.addWorkspaceFolder(uriToPath(folder.uri));
    });
});

// ─── Lifecycle ────────────────────────────────────────────────────────────────

connection.onShutdown(() => {
    indexer.dispose();
});

documents.listen(connection);
connection.listen();
