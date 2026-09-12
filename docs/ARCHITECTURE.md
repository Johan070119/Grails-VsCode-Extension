# Architecture

## Current layers

- `src/`: VS Code client, project UI and trusted command execution.
- `server/src/`: Grails-aware LSP server.
- `server/test/`: protocol-independent tests for indexing and language features.
- `test/`: client-side unit tests that do not require an Extension Host.

The TypeScript language server remains the stable Grails compatibility layer. It
owns conventions such as artifacts, controller/view navigation, injected services
and GORM completions.

## Semantic transition

The target design adds a JVM semantic engine based on the Apache-2.0 Groovy
Language Server. The build is pinned to upstream commit
`347d098a928707223ce44b52cc45174a6327a5f3` (2026-05-19) and its expected JAR
SHA-256 is recorded in `semantic-server/upstream.json`. The repository and npm
packages now consistently use Apache-2.0.

The spike confirmed that upstream already provides Groovy AST-based completion,
definition, type definition, hover, references, rename, signature help and
symbols. It also accepts an explicit JAR classpath. Remaining gaps that the
Grails extension must supply are:

1. Grails/GORM non-code members and DSL delegates;
2. cache invalidation, cancellation and performance for large projects;
3. response merging between the Grails and JVM language servers;
4. GSP virtual documents and cross-language navigation.

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

## Project model invariants

- Every project has an exact `versionInfo` when metadata exposes it.
- Maps of source types use qualified names; simple names map to a list to retain
  package collisions.
- A document is resolved to the longest matching project root.
- User-created paths must remain under the selected project node.
- External commands are allowed only in trusted workspaces and use fixed argument
  arrays resolved from Grails/Gradle wrappers.
