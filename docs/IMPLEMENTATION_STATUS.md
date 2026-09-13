# Implementation status

## Phase 0 — baseline and safety

- [x] Client and server compile independently.
- [x] Node test harness for server and pure client modules.
- [x] Linux, Windows and macOS CI definition.
- [x] Grails 2.5.6 and 7.1.1 version regression tests.
- [x] Path traversal checks for create/rename/delete workflows.
- [x] Workspace Trust gate for Grails/Gradle execution.
- [x] VS Code Extension Host integration tests on VS Code 1.82.3 and stable, including JVM integration.
- [x] Standardize repository and package metadata on Apache-2.0.
- [x] Replace README compatibility claims with a tested feature matrix.

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
- [x] Add an automated VSIX-content check for the staged JVM JAR and notices.
- [x] Feed Gradle-resolved classpath and source-set directories to the JVM server.
- [x] Merge and deduplicate generic Groovy and Grails language results, with Grails precedence.
- [x] Compiler-backed signature help, references, rename and diagnostics are exposed by the opt-in JVM server.
- [x] Performance budgets on TimeShare/TimeShare7 and cancellation-safe lifecycle tests.

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

## Phase 5 — cross-artifact navigation and refactoring

- [x] Convention-aware references for classes, injected services, actions, views/templates and packages.
- [x] Safe rename for classes/artifacts, actions, views/templates and packages, including file operations.
- [x] Incoming/outgoing call hierarchy for project methods and controller actions.
- [x] MVC CodeLens and document outline.
- [x] Completion, references and rename use unsaved Groovy/Java document contents.
- [x] Protocol and VS Code Extension Host tests cover navigation, rename, completion and unsaved buffers.
- [ ] Rich refactoring preview, compiler-backed local-symbol collision detection and persistent MVC graph.

## Release-candidate verification

- [x] VSIX content validation for compiled servers, bundled JVM JAR, license and notices.
- [x] Runtime dependency audit with zero known vulnerabilities.
- [x] Performance budgets for real Grails 2.5.6 and Grails 7.1.1 projects.
- [ ] Windows/macOS Extension Host E2E, SBOM/signing and automated Marketplace publication.

## Measured local baseline

The measurements below are informational and must not be asserted in CI because
they depend on storage and machine load.

| Project | Version | Domains | Controllers | Services | Indexed types |
|---|---:|---:|---:|---:|---:|
| TimeShare | 2.5.6 | 357 | 181 | 113 | 665 |
| TimeShare7 | 7.1.1 | 37 | 2 | 10 | 80 |

On the 0.7.0 release-candidate run, project-model construction measured about
3.83 s for TimeShare and 1.08 s for TimeShare7. Warm references measured about
70 ms and 8 ms respectively; both projects remained inside their configured
latency and memory budgets. Results vary with storage and machine load.
