# Architecture

## Current layers

- `src/`: VS Code client, project UI and trusted command execution.
- `server/src/`: Grails-aware LSP server.
- `server/test/`: protocol-independent tests for indexing and language features.
- `semantic-server/`: pinned JVM Groovy Language Server and upstream notices.
- `test/`: client-side unit tests plus `test/e2e/` Extension Host scenarios.

The TypeScript language server remains the stable Grails compatibility layer. It
owns conventions such as artifacts, controller/view navigation, injected services
and GORM completions.

## Dual-server semantic architecture

The extension includes a JVM semantic engine based on the Apache-2.0 Groovy
Language Server. The build is pinned to upstream commit
`347d098a928707223ce44b52cc45174a6327a5f3` (2026-05-19) and its expected JAR
SHA-256 is recorded in `semantic-server/upstream.json`. The repository and npm
packages now consistently use Apache-2.0.

The VS Code client owns fusion. It asks the Grails server and the workspace's JVM
server, deduplicates equivalent results, and gives the Grails result precedence
where conventions or file operations matter. Rename uses the Grails edit first
so controller/view and class/file changes stay atomic; the JVM server is the
generic Groovy/Java fallback.

The JVM lifecycle is serialized and cancellation-safe. A restart aborts pending
Gradle discovery/startup, disposes stale clients, enforces a startup deadline and
starts at most one server per Grails workspace root. Configuration, workspace
folder and trust changes schedule a restart. Remaining semantic gaps are:

1. Grails/GORM non-code members and DSL delegates;
2. broader classpath compatibility across Grails/Groovy/plugin combinations;
3. GSP virtual documents and compiler-backed expression types;
4. richer compiler-backed refactoring and cross-language call graphs.

## Gradle model bridge

When the experimental semantic engine is enabled, the trusted VS Code client
runs only the project's Gradle Wrapper with the bundled init script. The script
creates an isolated reporting task and emits one JSON record containing resolved
main classpath entries and source roots. It does not modify the build files.

Gradle evaluation executes project-controlled code, so this bridge is never run
in Restricted Mode. Manual classpath entries are merged after discovered entries
and remain available as a fallback.

Until the JVM engine reaches parity, the source index in `grailsProject.ts`
provides a deterministic bridge for project Groovy/Java classes. It is not
considered a replacement for compiler-backed semantics.

## Unsaved document model

The Grails server keeps overlays for open Groovy/Java documents. `didOpen` and
`didChange` update both the text-document store and the project source model;
disk reads used by completion, references and rename prefer the overlay. On
`didClose`, the overlay is removed and the disk version is restored. This keeps
editor operations coherent without writing user files.

## Release verification

`npm run test:e2e` drives the installed extension through VS Code commands.
`npm run test:performance` checks the configured TimeShare/TimeShare7 budgets.
`npm run package:release` builds a VSIX and rejects it when compiled servers, the
semantic JAR, license or notices are missing, or development sources leak in.

## Project model invariants

- Every project has an exact `versionInfo` when metadata exposes it.
- Maps of source types use qualified names; simple names map to a list to retain
  package collisions.
- A document is resolved to the longest matching project root.
- User-created paths must remain under the selected project node.
- External commands are allowed only in trusted workspaces and use fixed argument
  arrays resolved from Grails/Gradle wrappers.
