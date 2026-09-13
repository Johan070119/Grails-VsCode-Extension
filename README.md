# Grails Support for VS Code

[![Version](https://img.shields.io/visual-studio-marketplace/v/JohanMixtegaCisneros.grails-extension-vscode)](https://marketplace.visualstudio.com/items?itemName=JohanMixtegaCisneros.grails-extension-vscode)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/JohanMixtegaCisneros.grails-extension-vscode)](https://marketplace.visualstudio.com/items?itemName=JohanMixtegaCisneros.grails-extension-vscode)
![Grails](https://img.shields.io/badge/Grails-2.5.6%20%7C%207.1.x-green)
![VS Code](https://img.shields.io/badge/VS%20Code-1.82+-blue)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue)](LICENSE.md)

Soporte para desarrollar aplicaciones Grails en Visual Studio Code, inspirado en la experiencia de IntelliJ IDEA. Grails 7.1.x es la prioridad actual y Grails 2.5.6 se mantiene como carril de regresión; otras versiones permanecen experimentales hasta completar su matriz de pruebas.

## Novedades de la versión 0.7.0

- Fusión y deduplicación de completion, definición, referencias, hover y símbolos entre el servidor Grails TypeScript y el servidor semántico JVM.
- Lifecycle reiniciable y cancelable del servidor JVM, con timeout de inicio, límite de memoria, reinicio manual y soporte multi-root.
- Find References, rename y Call Hierarchy conscientes de clases, artefactos, actions, views e imports/package de Grails.
- Completion, navegación, referencias y rename sobre el contenido actual de archivos Groovy/Java sin guardar.
- Pruebas reales en VS Code Extension Host 1.82.3 y estable, incluida la integración JVM.
- Presupuestos reproducibles de indexación, referencias, completion y memoria verificados con TimeShare 2.5.6 y TimeShare7 7.1.1.
- Empaquetado verificable: el VSIX se rechaza si falta el servidor JVM, sus avisos/licencias o los servidores compilados, o si contiene fuentes/tests.

---

## Características

### 📝 Autocompletado Inteligente

El servidor LSP analiza tu proyecto en tiempo real e indexa dominios, controllers, servicios y clases Groovy/Java al abrir el workspace. El soporte semántico profundo para Grails 7 está actualmente en desarrollo.

**Domain Classes y GORM**
- Propiedades del dominio al escribir `instancia.`
- Dynamic finders: `Book.findByTitle(`, `Book.findAllByAuthorIlike(`, `Book.countByPagesGreaterThan(`
- Chaining de finders: `Book.findByTitleAnd` → sugiere `AndAuthor`, `AndPrice`, etc.
- Métodos estáticos: `list()`, `get()`, `getAll()`, `read()`, `load()`, `withCriteria { }`, `where { }`, `whereAny { }`
- Métodos de instancia: persistencia, validación, dirty checking, locking y sesión
- Relaciones `hasMany`/`belongsTo` y helpers `addTo*`/`removeFrom*`
- Completion dentro de `constraints`, `mapping`, criteria builders y consultas `where`

**Controllers y Servicios**
- Al escribir `miServicio.` muestra los métodos del servicio parseados en tiempo real
- Al escribir `MiController.` muestra las acciones del controller
- Al escribir `MiService.` (por nombre de clase) muestra los métodos del servicio
- Sugerencias de nombres de clase al empezar a escribir (`Swagger` → `SwaggerController`, `Fusion` → `FusionIntegrationService`)
- Funciona con todos los estilos de declaración: `def miServicio`, `MiService miServicio`, y referencias por clase directa
- Soporta métodos `public static`, `private`, `protected` y con tipos de retorno Java

**Controllers — scope y navegación**
- Variables de scope: `params`, `request`, `response`, `session`, `flash`, `grailsApplication`, `servletContext`, `controllerName`, `actionName`
- `render(` y `redirect(` con sus named arguments (`view:`, `model:`, `action:`, `controller:`)
- Al escribir `view: "` muestra las vistas GSP disponibles con navegación de carpetas
- Al escribir `controller: "` lista los controllers del proyecto
- Al escribir `action: "` lista las acciones del controller destino

**Imports**
- `import com.miPaquete.` autocompleta con dominios, controllers y servicios del proyecto sin duplicar texto

```groovy
// Autocompletado de métodos del servicio (inyectado o por clase)
fusionTokenService.    // → validateToken, invalidateToken, clearCache, getToken...
FusionTokenService.    // → mismos métodos
accountActivationService.  // → activateAccount, resendActivationToken...

// Autocompletado de acciones del controller
SwaggerController.     // → index, oauth2Redirect...

// Autocompletado de propiedades del dominio
def book = Book.findByTitle("Groovy")
book.   // → title, author, price, save(), delete(), validate()...

// Autocompletado de vistas
render(view: "/layouts/")  // → muestra carpetas y .gsp dentro de views/layouts/
```

---

### 🔍 Navegación (Ctrl+Click / Cmd+Click)

| Desde | Cursor sobre | Navega a |
|---|---|---|
| Controller | Nombre de Domain Class | Domain class |
| Controller | `book.title` | Línea exacta de `String title` en el dominio |
| Controller | `book?.id` | Línea exacta (safe navigation soportado) |
| Controller | `Area.findByNombre(` | Línea de `String nombre` en `Area.groovy` |
| Controller | `render(view: 'show')` | `views/book/show.gsp` |
| Controller | `render(view: '/layouts/main')` | `views/layouts/main.gsp` |
| Controller | `render(template: 'row')` | `views/book/_row.gsp` |
| Controller | `redirect(action: 'logIn')` | Línea de `def logIn()` en el mismo controller |
| Controller | `redirect(controller: 'book', action: 'show')` | Línea de `def show()` en `BookController` |
| Controller | `securityService.registerMember(` | Línea exacta del método en `SecurityService` |
| Controller | `SwaggerController.oauth2Redirect(` | Línea exacta del método en `SwaggerController` |
| Controller | `TestService.servicio(` | Línea exacta del método en `TestService` |
| Controller | `renderResponse(` | Línea del método local en el mismo archivo |
| Cualquier archivo | `BookController` | `BookController.groovy` |
| Cualquier archivo | `def bookService` | `BookService.groovy` |
| GSP | `<g:render template="row">` | `_row.gsp` en la misma carpeta |
| GSP | `controller="book" action="show"` | Línea de `def show()` en `BookController` |
| GSP | `<app:badge>` | Closure `badge` en el TagLib del proyecto |
| GSP | `<asset:javascript src="application.js">` | Recurso de Asset Pipeline |
| GSP | `<meta name="layout" content="main">` | `views/layouts/main.gsp` |

```groovy
class BookController {
    def bookService           // Ctrl+Click → BookService.groovy
    ToolsService toolsService // Ctrl+Click → ToolsService.groovy

    def show() {
        def book = Book.get(params.id)   // Ctrl+Click en Book → Book.groovy
        book.title                        // Ctrl+Click en title → línea exacta
        bookService.findRelated(book)     // Ctrl+Click en findRelated → método exacto
        render(view: "show")              // Ctrl+Click en "show" → show.gsp
    }
}
```

---

### ♻️ Referencias, rename y jerarquía de llamadas

- `Find All References` entiende nombres de clases, services inyectados, controllers/actions, views/templates y declaraciones `package`/`import`.
- `Rename Symbol` actualiza referencias y, cuando corresponde, renombra el archivo de la clase, vista o template mediante `WorkspaceEdit`.
- `Call Hierarchy` muestra llamadas entrantes y salientes entre métodos/actions del código del proyecto.
- Las operaciones Grails tienen prioridad; el servidor JVM completa los casos genéricos de Groovy/Java cuando está habilitado.
- Completion, referencias y rename leen el texto sin guardar de los documentos abiertos.

---

### 🏗️ Vista de Proyecto (panel lateral)

Un panel dedicado en la barra de actividad muestra solo las carpetas relevantes de tu proyecto Grails, similar a IntelliJ IDEA. Muestra la versión detectada de Grails al inicio del árbol.

```
GRAILS PROJECT
├── Grails 2.5.6  (versión detectada)
└── grails-app
    ├── controllers
    ├── domain
    ├── services
    ├── views
    ├── conf
    ├── i18n
    └── taglib
├── src/main/groovy
└── web-app
```

Se actualiza automáticamente al crear o eliminar archivos.

---

### 🛠️ Creación de Artefactos (clic derecho en el árbol)

Crea artefactos directamente desde el árbol del proyecto sin necesidad del CLI de Grails. Los archivos se crean en la carpeta exacta donde haces clic derecho.

| Carpeta | Acción principal | Otras opciones disponibles |
|---|---|---|
| `controllers/` | Nuevo Controller | Todos los artefactos, Nueva Carpeta, Nuevo Archivo |
| `domain/` | Nuevo Domain Class | Todos los artefactos, Nueva Carpeta, Nuevo Archivo |
| `services/` | Nuevo Service | Todos los artefactos, Nueva Carpeta, Nuevo Archivo |
| `views/` | Nueva Vista GSP | Todos los artefactos, Nueva Carpeta, Nuevo Archivo |
| Cualquier carpeta | — | Nuevo Controller/Domain/Service/Vista, Nueva Carpeta, Nuevo Archivo |
| Cualquier archivo o carpeta | — | Renombrar, Eliminar |

**Características de la creación:**
- Soporte de sub-paquetes: escribe `com/example/Book` para crear en subcarpetas
- Package inferido automáticamente de la ruta (`grails-app/services/auth/` → `package auth`)
- Template del Service adaptado a la versión de Grails detectada:
  - Grails 2.0–2.3: `static transactional = true`
  - Grails 2.4–5.x: `import grails.transaction.Transactional` + `@Transactional`
  - Grails 6.x–7+: `import grails.gorm.transactions.Transactional` + `@Transactional`

**Renombrar con refactor de package:**
Al renombrar una carpeta, la extensión ofrece actualizar automáticamente las declaraciones `package` en todos los archivos `.groovy` dentro de ella, incluyendo sub-paquetes.

```groovy
// Al renombrar grails-app/services/security/ → grails-app/services/auth/
// Pregunta: "¿Actualizar declaraciones package?"
// package security        → package auth
// package security.utils  → package auth.utils
```

---

### ⚡ Integración con Grails CLI

Comandos disponibles desde `Ctrl+Shift+P` (`Cmd+Shift+P` en Mac):

| Comando | Descripción |
|---|---|
| `Grails: Run App` | `grails run-app` |
| `Grails: Run App (Debug)` | `grails run-app --debug-jvm` |
| `Grails: Stop App` | `grails stop-app` |
| `Grails: Run Tests` | `grails test-app` |
| `Grails: Clean` | `grails clean` |
| `Grails: Compile` | `grails compile` |

Los comandos prefieren `grailsw` cuando existe, después usan `gradlew` para tareas compatibles y finalmente Grails instalado en el sistema. Cada proyecto reutiliza su propio terminal y la ejecución solo está disponible en workspaces confiables.

**Status bar:** muestra la versión de Grails detectada (`⬡ Grails 2.5.6`). Haz clic para ejecutar `grails run-app`.

---

### 🔗 CodeLens en Controllers

Al abrir un controller, aparece un enlace encima de cada acción que tiene una vista GSP correspondiente:

```groovy
$(file-code) show.gsp          // ← clic abre views/book/show.gsp
def show() {
    ...
}
```

---

## Compatibilidad

La matriz distingue lo que se ejecuta continuamente de lo que aún es una promesa experimental:

| Grails | Modelo/GORM | GSP/navegación | References/rename | Presupuesto real | Estado |
|---|---|---|---|---|---|
| 2.5.6 | Probado | Probado | Probado | TimeShare | Regresión mantenida |
| 3.x–5.x | Básico | Básico | Experimental | — | Sin matriz completa |
| 6.x | Básico | Básico | Experimental | — | Experimental |
| 7.1.1 | Probado | Probado | Probado | TimeShare7 | Prioridad y versión recomendada |
| 8.x | — | — | — | — | Planificado |

La integración completa se prueba con VS Code 1.82.3 y con la versión estable. El servidor JVM requiere JDK 17 o superior; el servidor TypeScript y las funciones Grails rápidas siguen disponibles cuando la semántica JVM está desactivada o no puede iniciarse.

Detección automática de versión desde `gradle.properties`, `build.gradle`, `build.gradle.kts` y `application.properties`.

---

## Requisitos

- VS Code 1.82.0 o superior
- Un proyecto que contenga la carpeta `grails-app/`
- Node.js (incluido con VS Code)

### GSP

Los archivos `.gsp` tienen un modo de lenguaje dedicado. La extensión combina la gramática HTML con expresiones y scriptlets Groovy, además de JavaScript y CSS embebidos. El servidor Grails aporta tags, atributos, rutas, navegación y diagnósticos; la validación semántica completa mediante documentos virtuales continúa en desarrollo.

### Servidor semántico JVM

La versión 0.7.0 integra el servidor Groovy JVM con el servidor Grails y deduplica sus respuestas. Permanece desactivado por defecto porque su classpath compiler-backed todavía debe validarse contra más combinaciones de Grails, Groovy y plugins. Para activarlo:

1. Instala un JDK 17 o superior.
2. Abre un workspace confiable.
3. Activa `grails.semantic.enabled` en Settings.

La extensión obtiene el classpath y los source sets mediante el Gradle Wrapper sin modificar el build. El JDK se toma de `grails.semantic.java.home`, `java.jdt.ls.java.home` o `JAVA_HOME`, en ese orden. Puedes desactivar la resolución Gradle con `grails.semantic.gradle.autoClasspath` o proporcionar entradas adicionales mediante `grails.semantic.classpath`.

Cada proyecto usa su propio proceso JVM. `grails.semantic.java.maxHeapMb` limita su heap y `grails.semantic.startupTimeout` evita inicios bloqueados. Los cambios de configuración, carpetas del workspace o confianza reinician los procesos de forma serial y cancelable; también puedes ejecutar `Grails: Reiniciar Servidor Semántico`.

Consulta [la arquitectura](docs/ARCHITECTURE.md), [el plan](docs/IMPLEMENTATION_PLAN.md) y [el estado](docs/IMPLEMENTATION_STATUS.md).

---

## Instalación

### Desde VS Code Marketplace

1. Abre VS Code
2. Ve a Extensiones (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Busca **"Grails Support for VS Code"**
4. Haz clic en Instalar

### Desde VSIX

```bash
code --install-extension grails-extension-vscode-0.7.0.vsix
```

---

## Uso

La extensión se activa automáticamente al abrir cualquier carpeta que contenga `grails-app/`. El indexado del proyecto ocurre al iniciar, se actualiza al cambiar archivos y usa el contenido de los buffers abiertos aun antes de guardarlos.

Para ver los logs del servidor LSP: `Ver → Output → Grails Language Server`

---

## Reportar Problemas

Si encuentras algún bug o tienes sugerencias:

- [Abrir un Issue en GitHub](https://github.com/Johan070119/Grails-VsCode-Extension/issues)
- Incluye la versión de Grails de tu proyecto
- Adjunta los logs del servidor (Ver → Output → Grails Language Server)
- Indica tu sistema operativo (Linux / Mac / Windows)

---

## Contribuir

¡Las contribuciones son bienvenidas! Lee [CONTRIBUTING_TECHNICAL.md](CONTRIBUTING_TECHNICAL.md) o abre un PR directamente.

1. Fork el proyecto
2. Crea tu rama (`git checkout -b feature/MiMejora`)
3. Commit tus cambios (`git commit -m 'feat: descripción'`)
4. Push (`git push origin feature/MiMejora`)
5. Abre un Pull Request

Al contribuir aceptas que tu código se distribuye bajo Apache License 2.0.

---

## Licencia

Apache License 2.0 — consulta [LICENSE.md](LICENSE.md) y [NOTICE](NOTICE).
