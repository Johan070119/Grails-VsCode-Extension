# Change Log

## [0.7.0] - 2026-09-13

### Added

- VS Code Extension Host integration tests for activation, completion, definition, references, rename, CodeLens and unsaved buffers, exercised with the semantic JVM server enabled.
- Grails-aware Find References, Rename Symbol, incoming/outgoing Call Hierarchy and MVC CodeLens support.
- Immediate project-model overlays for unsaved Groovy and Java documents.
- Restartable semantic-server lifecycle with cancellation, startup timeout, per-JVM heap limit, workspace-folder/trust/configuration restarts and a manual restart command.
- Performance budgets for project modeling, cold/warm references, GORM completion and memory, with local TimeShare 2.5.6 and TimeShare7 7.1.1 runners.
- Reproducible release packaging and VSIX content verification for compiled servers, the pinned JVM JAR, license notices and excluded development files.
- CI jobs for the minimum supported and stable VS Code Extension Hosts and a verified release-candidate artifact.

### Changed

- Grails TypeScript and JVM semantic results are now fused and deduplicated for completion, definition, references, hover and workspace symbols.
- Grails-aware rename and document symbols take priority, with compiler-backed JVM behavior as a fallback.
- The minimum supported VS Code version is now 1.82.0, matching `vscode-languageclient` 9 requirements.
- The language client waits for the primary server to start and shuts down semantic processes deterministically.

### Fixed

- Repeated configuration/workspace restarts can no longer leave stale semantic JVM processes active.
- Completion no longer shows duplicate items when both language servers return the same Grails or Groovy symbol.
- Navigation, references and rename no longer ignore unsaved source changes.

### Security

- Semantic execution remains disabled in untrusted workspaces.
- Java/Gradle processes use argument arrays, bounded timeouts and bounded heap configuration; no project path is interpolated into a shell command.
- Runtime dependency audit passes with no known vulnerabilities at packaging time.

## [0.6.0] - 2026-09-12

### Added

- Dedicated `gsp` language mode with mixed HTML, Groovy expression/scriptlet, JavaScript and CSS tokenization.
- Grails and Asset Pipeline tag completion with context-aware attributes and snippets.
- Completion of controller names/actions, views, templates, layouts and static assets from GSP attributes.
- GSP navigation to templates, layouts, custom TagLib closures, controllers/actions and static assets.
- GSP hover, outline symbols and fast diagnostics for unknown tags, missing required attributes, invalid literal controllers/templates/layouts and unclosed expressions.
- Context-aware GORM completion inside `constraints`, `mapping`, criteria and `where` closures.
- Expanded static GORM API, persistence finders, criteria operators and dynamic-finder operators for domain properties.
- Expanded domain instance API, dirty checking and `addTo*`/`removeFrom*` association helpers.
- Parsed domain constraints and transient properties in the project model and hover information.
- Grails 7 controller scope members such as `grailsApplication`, `servletContext`, `controllerName`, `actionName`, `forward` and `header`.
- Regression tests covering the new Grails 7/GORM/GSP completion, navigation, hover and diagnostics.

### Changed

- `.gsp` files now use their own language identifier instead of being registered as plain Groovy.
- Package metadata now declares the SPDX `Apache-2.0` license identifier directly.

## [0.5.0] - 2026-09-11

### Added

- Test harness for project modeling, language features, path safety and command resolution.
- Multi-root language-server and Grails project explorer support.
- Exact Grails version metadata, modern source-root discovery, direct Gradle dependency inventory and incremental updates.
- Shared Groovy/Java source type index with qualified-name collision handling.
- Hover, document symbols, workspace symbols and basic project source member completion/navigation.
- Experimental, opt-in JVM Groovy semantic server adapter with one process per Grails root.
- Trusted Gradle Wrapper bridge for automatic transitive classpath and source-set discovery.
- Bundled and reproducible semantic-server build pinned by upstream commit and SHA-256.
- Wrapper-first command resolution (`grailsw`, then `gradlew`, then system Grails).
- Cross-platform CI definition.

### Security

- Grails/Gradle execution is blocked in untrusted workspaces.
- File and folder prompts reject traversal outside the selected project.

### Changed

- Project licensing and npm metadata are now consistently Apache-2.0.

## [0.4.0] - 2026-03-16

### Added

**Autocompletado de métodos de servicios y controllers**
- Al escribir `miServicio.` ahora muestra la lista de métodos definidos en el servicio, parseados en tiempo real desde el archivo fuente
- Soporta todos los estilos de declaración de servicio: `def miServicio`, `MiService miServicio` (con tipo explícito), y referencias por nombre de clase directa (`MiService.metodo()`)
- Soporta métodos con cualquier modificador: `def`, `Map`, `String`, `boolean`, `void`, `public`, `private`, `protected`, `public static`, etc.
- Al escribir `SwaggerController.` o cualquier nombre de controller con punto, muestra sus acciones disponibles
- Al escribir `TestService.` o cualquier nombre de servicio con punto (importado como clase), muestra sus métodos

**Sugerencias de nombres de clase (sin punto)**
- Al empezar a escribir un nombre de controller o servicio (ej. `Swagger`, `Fusion`), el autocompletado sugiere `SwaggerController`, `FusionIntegrationService`, etc.
- No requiere import — funciona con cualquier artefacto indexado del proyecto

**Vista de proyecto mejorada**
- Nodo de versión de Grails al inicio del árbol (`Grails 2.5.6`)
- Iconos diferenciados por tipo de carpeta (controllers, domain, services, views, conf, i18n, taglib, assets)
- Soporte para estructura Grails 2 (`web-app/`) y Grails 3+ (`src/main/groovy`, `src/main/resources`)

**Creación de artefactos desde el árbol (clic derecho)**
- Crear Controller, Domain Class, Service, TagLib y Vista GSP directamente en la carpeta seleccionada, sin usar el CLI de Grails
- Soporte de sub-paquetes al crear: escribir `com/example/Book` crea las subcarpetas necesarias
- Package inferido automáticamente de la ruta del archivo
- Template de Service adaptado a la versión de Grails detectada:
  - Grails 2.0–2.3: `static transactional = true`
  - Grails 2.4–5.x: `import grails.transaction.Transactional` + `@Transactional`
  - Grails 6.x–7+: `import grails.gorm.transactions.Transactional` + `@Transactional`
- Crear carpeta genérica y archivo genérico con extensión libre
- Opciones de menú contextual organizadas por grupos: acción principal, genéricos y todos los artefactos Grails

**Renombrar y eliminar desde el árbol**
- Renombrar archivos y carpetas con clic derecho → Renombrar
- Al renombrar una carpeta, ofrece actualizar automáticamente las declaraciones `package` en todos los archivos `.groovy` dentro de ella (incluyendo sub-paquetes)
- Eliminar archivos y carpetas con confirmación modal

**Navegación (Ctrl+Click) extendida**
- `SwaggerController.metodo()` → navega a la línea exacta del método en el controller
- `TestService.metodo()` (referencia por clase directa) → navega a la línea exacta del método en el service
- Soporte para métodos `public static` y con tipos de retorno Java en la navegación

**Status bar**
- Muestra la versión de Grails detectada (`⬡ Grails 2.5.6`) en la barra de estado
- Clic en el status bar ejecuta `grails run-app`

**CodeLens en controllers**
- Aparece un enlace `$(file-code) show.gsp` encima de cada acción que tiene una vista GSP correspondiente
- Clic en el CodeLens abre directamente la vista

### Fixed

- Autocompletado de servicios con nombres multi-palabra (ej. `fusionTokenService`, `accountActivationService`) que antes no mostraba métodos debido a un error de camelCase splitting en la detección de contexto
- Regex `serviceMatch` e `instanceMatch` corregidos — un byte de control invisible (`\x08`) que se había colado en el código impedía que los regex matchearan, causando que todos los servicios inyectados cayeran a `generic_grails` sin mostrar métodos
- Métodos `public static` de servicios (como en `ToolsService`) ahora se detectan correctamente por el parser de métodos
- Menú contextual del árbol: la opción "Nueva Vista GSP" ya no aparece en carpetas que no son de vistas; cada carpeta muestra su opción principal correspondiente
- Al completar un nombre de controller o service y presionar Enter, ya no se inserta un punto extra (`TestService..` → `TestService`)
- Comparación case-insensitive en `declaredServiceCompletions` para servicios multi-palabra (ej. `fusionTokenService` → `FusionTokenService`)

---

## [0.3.1] - 2026-03-15

### Added
- **Vista de proyecto estilo IntelliJ** — nuevo panel lateral en la Activity Bar que muestra únicamente las carpetas relevantes de Grails (`grails-app/controllers`, `domain`, `services`, `views`, `conf`, `i18n`, `taglib`) y `src/`, `test/`, `web-app/` según la versión del proyecto. Se auto-refresca al crear o eliminar archivos.
- **Integración con Grails CLI** — comandos disponibles desde `Ctrl+Shift+P` (`Cmd+Shift+P` en Mac) y como botones en el panel:
  - `Grails: Run App` — ejecuta `grails run-app` en terminal dedicado
  - `Grails: Run App (Debug)` — ejecuta `grails run-app --debug-jvm`
  - `Grails: Stop App`
  - `Grails: Run Tests`
  - `Grails: Clean`
  - `Grails: Create Controller / Domain Class / Service` — pide nombre y crea el artefacto
  - `Grails: Generate All (Scaffold)`
- **Compatibilidad multi-versión** — detección automática de Grails 2.x, 3.x, 4.x, 5.x, 6.x y 7+ desde `gradle.properties`, `build.gradle`, `build.gradle.kts` y `application.properties`
- **Compatibilidad con Mac y Windows** — corregido bug de URIs (`file://` vs `file:///`) que impedía que Ctrl+Click y los completados funcionaran en macOS y Windows
- **Soporte de tipos modernos en autocompletado** — `LocalDate`, `LocalDateTime`, `ZonedDateTime`, `OffsetDateTime`, `Instant`, `UUID`, `BigInteger` y clases de dominio propias como tipo de propiedad (ej. `Area padre`)
- **Soporte para dominios en `src/main/groovy`** — detecta clases con `@Entity`, `@MappedEntity` o bloque `static constraints` en proyectos Grails 3+

---

## [0.2.0] - 2026-03-14

### Added
- **Go to Definition completo** — `Ctrl+Click` / `Cmd+Click` navega a:
  - Domain class desde controller (por nombre o por `Domain.findBy...`)
  - Propiedad exacta de dominio (`book.title` → línea de `String title`)
  - Vista GSP desde `render(view: 'show')` — rutas absolutas (`/layouts/main`) y relativas
  - Template desde `render(template: 'row')` — resuelve `_row.gsp` automáticamente
  - Action de controller desde `redirect(action: 'logIn')` — mismo controller si no se especifica
  - Controller externo desde `redirect(controller: 'book', action: 'show')`
  - Método de servicio desde `securityService.registerMember(...)` — línea exacta
  - Método local del mismo controller (`renderResponse`, acciones internas)
  - Propiedad con safe navigation (`area?.id` igual que `area.id`)
  - Variables con tipo inferido (`def areas = Area.findAllBy*` → resuelve `areas.propiedad`)
  - Tags GSP: `<g:render template="row">` → `_row.gsp`, `controller="book"` → `BookController`
- **Autocompletado contextual mejorado**:
  - `import` — muestra domains, controllers y servicios del proyecto con `textEdit` preciso (sin duplicar texto ya escrito)
  - `controller: ""` — lista todos los controllers disponibles
  - `action: ""` — lista acciones del controller destino (o del actual si no hay `controller:`)
  - `view: ""` — navega el árbol de `grails-app/views/` con soporte de rutas absolutas (`/`) y relativas
  - Métodos de servicios al escribir `miServicio.` — parsea el archivo del servicio en tiempo real
  - Snippets de `render` y `redirect` con choice placeholders (`view`, `template`, `text`, `json`)

### Fixed
- Autocompletado de `render(view: '/...')` ahora resuelve desde la raíz de `views/` en lugar de la raíz del proyecto
- Templates sin underscore (`template: 'row'`) resuelven correctamente a `_row.gsp` en disco
- `redirect(action: 'logIn')` sin `controller:` ahora navega dentro del mismo controller

---

## [0.1.0] - 2026-03-14

### Added
- Autocompletado básico para Domain Classes (propiedades y métodos GORM: `findBy*`, `findAllBy*`, `list`, `get`, `save`, `delete`, `validate`)
- Autocompletado de scope de controller (`render`, `redirect`, `params`, `request`, `session`, `flash`)
- Navegación `Ctrl+Click` inicial en controllers y vistas
- Indexación automática de la estructura Grails al abrir el workspace
- Re-indexación con debounce al guardar archivos `.groovy`
- Servidor LSP integrado (`vscode-languageserver`) con soporte para archivos `.groovy` y `.gsp`
