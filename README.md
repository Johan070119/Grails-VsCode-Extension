# Grails Support for VS Code

[![Version](https://img.shields.io/visual-studio-marketplace/v/JohanMixtegaCisneros.grails-extension-vscode)](https://marketplace.visualstudio.com/items?itemName=JohanMixtegaCisneros.grails-extension-vscode)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/JohanMixtegaCisneros.grails-extension-vscode)](https://marketplace.visualstudio.com/items?itemName=JohanMixtegaCisneros.grails-extension-vscode)
![Grails](https://img.shields.io/badge/Grails-2.x%20–%207%2B-green)
![VS Code](https://img.shields.io/badge/VS%20Code-1.80+-blue)
[![License](https://img.shields.io/badge/License-GPL%20v3%20%2B%20Non--Commercial-red)](LICENSE)

Soporte avanzado para el desarrollo de aplicaciones Grails en Visual Studio Code, inspirado en la experiencia de IntelliJ IDEA. Compatible con Grails 2.x hasta 7+.

---

## Características

### 📝 Autocompletado Inteligente

El servidor LSP analiza tu proyecto en tiempo real e indexa dominios, controllers y servicios al abrir el workspace.

**Domain Classes y GORM**
- Propiedades del dominio al escribir `instancia.`
- Dynamic finders: `Book.findByTitle(`, `Book.findAllByAuthor(`
- Chaining de finders: `Book.findByTitleAnd` → sugiere `AndAuthor`, `AndPrice`, etc.
- Métodos estáticos: `list()`, `get()`, `count()`, `exists()`, `withCriteria { }`, `where { }`
- Métodos de instancia: `save()`, `delete()`, `validate()`, `hasErrors()`, `refresh()`
- Relaciones `hasMany` y `belongsTo`

**Controllers y Servicios**
- Al escribir `miServicio.` muestra los métodos del servicio parseados en tiempo real
- Al escribir `MiController.` muestra las acciones del controller
- Al escribir `MiService.` (por nombre de clase) muestra los métodos del servicio
- Sugerencias de nombres de clase al empezar a escribir (`Swagger` → `SwaggerController`, `Fusion` → `FusionIntegrationService`)
- Funciona con todos los estilos de declaración: `def miServicio`, `MiService miServicio`, y referencias por clase directa
- Soporta métodos `public static`, `private`, `protected` y con tipos de retorno Java

**Controllers — scope y navegación**
- Variables de scope: `params`, `request`, `response`, `session`, `flash`
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

Todos los comandos reusan el mismo terminal "Grails" en lugar de abrir uno nuevo cada vez.

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

| Grails | Spring Boot | Groovy | Java | Estado |
|---|---|---|---|---|
| 2.x | — | 2.x | 7+ | ✅ Soportado |
| 3.x | 1.x | 2.x | 8+ | ✅ Soportado |
| 4.x | 2.x | 2.x | 8+ | ✅ Soportado |
| 5.x | 2.6+ | 3.x | 11+ | ✅ Soportado |
| 6.x | 3.x | 4.x | 17+ | ✅ Soportado |
| 7+ | 3.2+ | 4.x | 17+ | ✅ Soportado |

Detección automática de versión desde `gradle.properties`, `build.gradle`, `build.gradle.kts` y `application.properties`.

---

## Requisitos

- VS Code 1.80.0 o superior
- Un proyecto que contenga la carpeta `grails-app/`
- Node.js (incluido con VS Code)

---

## Instalación

### Desde VS Code Marketplace

1. Abre VS Code
2. Ve a Extensiones (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Busca **"Grails Support for VS Code"**
4. Haz clic en Instalar

### Desde VSIX

```bash
code --install-extension grails-extension-vscode-0.4.0.vsix
```

---

## Uso

La extensión se activa automáticamente al abrir cualquier carpeta que contenga `grails-app/`. El indexado del proyecto ocurre al iniciar y se actualiza automáticamente cuando guardas archivos `.groovy`.

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

¡Las contribuciones son bienvenidas! Lee [CONTRIBUTING.md](CONTRIBUTING.md) o abre un PR directamente.

1. Fork el proyecto
2. Crea tu rama (`git checkout -b feature/MiMejora`)
3. Commit tus cambios (`git commit -m 'feat: descripción'`)
4. Push (`git push origin feature/MiMejora`)
5. Abre un Pull Request

Al contribuir aceptas que tu código se distribuye bajo la misma licencia del proyecto (GPL v3 + restricción no comercial).

---

## Licencia

GPL v3 con restricción de uso no comercial — ver [LICENSE](LICENSE) para los términos completos.

En resumen: puedes usar, modificar y distribuir libremente este software, pero **no puedes cobrar por él ni por ningún trabajo derivado**.
