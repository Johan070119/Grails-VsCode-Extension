# Change Log

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
