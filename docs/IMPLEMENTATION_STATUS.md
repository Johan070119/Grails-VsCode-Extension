# Implementation status

## Phase 0 — baseline and safety

- [x] Client and server compile independently.
- [x] Node test harness for server and pure client modules.
- [x] Linux, Windows and macOS CI definition.
- [x] Grails 2.5.6 and 7.1.1 version regression tests.
- [x] Path traversal checks for create/rename/delete workflows.
- [x] Workspace Trust gate for Grails/Gradle execution.
- [ ] VS Code Extension Host integration tests.
- [x] Standardize repository and package metadata on Apache-2.0.
- [ ] Replace README compatibility claims with a tested feature matrix.

## Phase 1 — project model

- [x] Exact version metadata and detection source.
- [x] Multi-root model in the language server.
- [x] Modern, test and integration source-root discovery.
- [x] Groovy and Java project source index.
- [x] Qualified type names and simple-name collision index.
- [x] Direct Gradle dependency inventory.
- [x] Cached reads across artifact and semantic passes.
- [x] Wrapper-first command resolution with Gradle fallback.
- [x] Trusted Gradle Wrapper bridge for resolved main classpath and source sets.
- [ ] Replace the init-script bridge with Tooling API/build-action integration if measurements justify it.
- [x] Incremental per-file source updates; build metadata triggers a full rebuild.
- [x] Multi-root project tree in the VS Code client.

## Phase 2 — semantic core

- [x] Upstream Groovy Language Server architecture spike.
- [x] Project Groovy/Java type and member bridge.
- [x] Generic project class/member completion and definition.
- [x] Hover, document symbols and workspace symbols.
- [x] Experimental multi-root JVM client adapter (bundled JAR or configured override, opt-in).
- [x] Reproducible JVM build definition pinned by commit and JAR SHA-256.
- [x] Stage the verified JVM JAR for inclusion in extension packages.
- [ ] Add an automated VSIX-content check for the staged JVM JAR and notices.
- [x] Feed Gradle-resolved classpath and source-set directories to the JVM server.
- [ ] Merge generic Groovy and Grails completion without duplicates.
- [x] Compiler-backed signature help, references, rename and diagnostics are exposed by the opt-in JVM server.
- [ ] Performance/cancellation tests on TimeShare-sized projects.

## Phase 3 — Grails 7 and GORM semantics

- [x] Index domains, controllers, services, TagLibs and project Groovy/Java types.
- [x] Complete common injected controller members and declared services.
- [x] Complete the common static/instance GORM API and property-aware dynamic finders.
- [x] Complete `constraints`, `mapping`, criteria and `where` closure DSLs.
- [x] Parse `hasMany`, `belongsTo`, constraints and transient properties.
- [ ] Model command objects and GORM Data Services as first-class artifact types.
- [ ] Infer generic association types, nullability and custom validator types through the compiler.
- [ ] Version-resolved API documentation for every GORM datastore/plugin.

## Phase 4 — GSP and web languages

- [x] Dedicated GSP language and mixed HTML/Groovy/JavaScript/CSS grammar.
- [x] Grails/Asset Pipeline tag and attribute completion.
- [x] Controller, action, view, template, layout, TagLib and asset navigation.
- [x] GSP hover and document symbols.
- [x] Fast diagnostics for literal tag/reference errors and unclosed expressions.
- [ ] Virtual-document projection into the HTML, CSS, JavaScript and Groovy language servers.
- [ ] Compiler-backed GSP expression types and plugin-provided tag descriptors.

## Measured local baseline

The measurements below are informational and must not be asserted in CI because
they depend on storage and machine load.

| Project | Version | Domains | Controllers | Services | Indexed types |
|---|---:|---:|---:|---:|---:|
| TimeShare | 2.5.6 | 357 | 181 | 113 | 665 |
| TimeShare7 | 7.1.1 | 37 | 4 | 10 | 80 |

With the file cache warm, repeated project model builds measured below one second
for both local projects. The remaining target is to avoid a full rebuild entirely.
