# Grails Support for VS Code — Documentación Técnica

> Guía para colaboradores. Explica la arquitectura, los archivos clave, los estándares de código y los patrones recurrentes del proyecto.

---

## Índice

1. [Visión general](#1-visión-general)
2. [Estructura del repositorio](#2-estructura-del-repositorio)
3. [Arquitectura LSP](#3-arquitectura-lsp)
4. [Archivos del servidor LSP](#4-archivos-del-servidor-lsp)
   - [grailsProject.ts — Indexador](#41-grailsprojectts--indexador)
   - [completion.ts — Autocompletado](#42-completionts--autocompletado)
   - [definition.ts — Go-to-Definition](#43-definitionts--go-to-definition)
   - [indexer.ts — Watcher de archivos](#44-indexerts--watcher-de-archivos)
   - [server.ts — Punto de entrada LSP](#45-serverts--punto-de-entrada-lsp)
   - [uriUtils.ts — Utilidades de URI](#46-uriutilsts--utilidades-de-uri)
5. [Archivo del cliente VS Code](#5-archivo-del-cliente-vs-code)
   - [extension.ts — Cliente VS Code](#51-extensionts--cliente-vs-code)
6. [package.json — Contribuciones VS Code](#6-packagejson--contribuciones-vs-code)
7. [Flujo de datos completo](#7-flujo-de-datos-completo)
8. [Estándares y convenciones](#8-estándares-y-convenciones)
9. [Bugs conocidos y soluciones aplicadas](#9-bugs-conocidos-y-soluciones-aplicadas)
10. [Cómo agregar una nueva feature](#10-cómo-agregar-una-nueva-feature)
11. [Compilación y desarrollo](#11-compilación-y-desarrollo)

---

## 1. Visión general

Esta extensión añade soporte de lenguaje Grails/Groovy a VS Code. Está construida sobre el protocolo LSP (Language Server Protocol) y tiene dos partes independientes:

- **Cliente** (`src/extension.ts`): código que corre dentro de VS Code. Gestiona la UI: árbol de proyecto, menú contextual, CLI, CodeLens, status bar.
- **Servidor LSP** (`server/src/`): proceso Node.js separado que analiza el código Groovy y responde peticiones de autocompletado y navegación.

La separación es importante: el cliente puede usar APIs de VS Code (`vscode.*`), el servidor **no puede** — solo usa `vscode-languageserver`.

---

## 2. Estructura del repositorio

```
grails-vscode-extension/
│
├── src/
│   └── extension.ts          ← Cliente VS Code (UI, árbol, CLI, CodeLens)
│
├── server/
│   └── src/
│       ├── server.ts         ← Entrada LSP, registra capabilities
│       ├── completion.ts     ← Autocompletado contextual
│       ├── definition.ts     ← Go-to-Definition (Ctrl+Click)
│       ├── grailsProject.ts  ← Indexador de artefactos Grails
│       ├── indexer.ts        ← Watcher de cambios en archivos
│       └── uriUtils.ts       ← Conversión path ↔ URI (cross-platform)
│
├── images/
│   └── grails-icon.svg       ← Ícono oficial Grails (Activity Bar)
│
├── package.json              ← Manifest VS Code (comandos, vistas, menús)
├── tsconfig.json             ← Config TypeScript del cliente
└── server/
    ├── tsconfig.json         ← Config TypeScript del servidor
    └── dist/                 ← JS compilado del servidor (gitignored)
```

### Compilación separada

```bash
# Cliente (src/ → dist/)
npx tsc -p tsconfig.json

# Servidor (server/src/ → server/dist/)
cd server && npx tsc -p tsconfig.json
```

El `main` en `package.json` apunta a `./dist/extension.js` (cliente).
El servidor se lanza desde `server/dist/server.js` vía IPC.

---

## 3. Arquitectura LSP

```
VS Code
  │
  │  (IPC — stdio)
  ▼
extension.ts (cliente)
  │  LanguageClient
  │  arranca server/dist/server.js
  ▼
server.ts
  │  onCompletion  → completion.ts → getCompletions()
  │  onDefinition  → definition.ts → getDefinition()
  │  onInitialize  → indexer.ts    → GrailsIndexer.initialize()
  │
  └─ GrailsIndexer
       │  buildGrailsProject()
       └─ GrailsProject (Map de dominios, controllers, servicios)
```

El servidor mantiene **un único objeto `GrailsProject`** en memoria. Se reconstruye completo (debounce 300ms) cuando un archivo `.groovy` cambia.

---

## 4. Archivos del servidor LSP

### 4.1 `grailsProject.ts` — Indexador

**Responsabilidad:** escanear el disco y construir el modelo de datos del proyecto.

**Tipos exportados:**

```typescript
interface DomainClass {
    name: string;
    filePath: string;
    properties: DomainProperty[];   // { name, type }
    hasMany: Record<string, string>;
    belongsTo: Record<string, string>;
}

interface GrailsArtifact {
    name: string;        // "BookController"
    simpleName: string;  // "book" (lowercase, sin sufijo)
    filePath: string;
    kind: "controller" | "service" | "taglib" | "domain";
}

interface GrailsProject {
    root: string;
    version: GrailsVersion;          // "2" | "3" | "4" | "5" | "6" | "7+" | "unknown"
    domains:     Map<string, DomainClass>;    // key = class name, ej. "Book"
    controllers: Map<string, GrailsArtifact>; // key = "BookController"
    services:    Map<string, GrailsArtifact>; // key = "BookService"
    taglibs:     Map<string, GrailsArtifact>; // key = "BookTagLib"
}
```

**Función principal:**

```typescript
export function buildGrailsProject(root: string): GrailsProject
```

**Detección de versión** (`detectGrailsVersion`): busca en este orden:
1. `gradle.properties` → `grailsVersion=X.Y.Z`
2. `build.gradle` / `build.gradle.kts` → patrones múltiples
3. `application.properties` → `app.grails.version=X.Y.Z`
4. Presencia de `grails-app/conf/BuildConfig.groovy` → Grails 2

**Directorios escaneados por versión:**
- Dominios: `grails-app/domain/`, `grails-app/utils/`, `src/main/groovy/` (Grails 3+)
- Controllers: `grails-app/controllers/`
- Servicios: `grails-app/services/`
- Taglibs: `grails-app/taglib/`

**Filtro para `src/main/groovy`** (`looksLikeDomainClass`): solo se indexa si tiene `@Entity`, `@MappedEntity`, `static constraints`, `static mapping`, o el path contiene `/domain/`.

**Parser de propiedades** (`PROPERTY_RE`): regex que captura `TipoJava nombreCampo` al inicio de línea, excluyendo métodos (no puede tener `(` después del nombre). Ignora campos en `SKIP_FIELD_NAMES` (dateCreated, version, errors, etc.) y tipos en `SKIP_TYPE_NAMES` (if, static, def, etc.).

---

### 4.2 `completion.ts` — Autocompletado

**Responsabilidad:** dado un documento y posición del cursor, devolver una lista de `CompletionItem[]`.

**Punto de entrada:**
```typescript
export function getCompletions(
    doc: TextDocument,
    params: TextDocumentPositionParams,
    project: GrailsProject | null
): CompletionItem[]
```

#### Sistema de detección de contexto

La función `detectContext()` analiza la línea desde el inicio hasta el cursor (`lineUpTo`) y devuelve un `CompletionContext` con un `kind` que determina qué tipo de sugerencias mostrar.

**Orden de evaluación de contextos** (importa — el primero que matchea gana):

| Orden | Kind | Regex / Condición |
|-------|------|-------------------|
| 1 | `import` | `/^(\s*import\s+)([\w.]*)$/` |
| 2 | `string_controller` | `/controller\s*:\s*['"][^'"]*$/` |
| 3 | `string_action` | `/action\s*:\s*['"][^'"]*$/` |
| 4 | `string_view` | `/view\s*:\s*['"][^'"]*$/` |
| 5 | `render_redirect_key` | `/\b(render\|redirect)\s*\([^)]*$/` |
| 6 | `gorm_static` / `controller_static` / `service_injection` | `pkgDomainMatch` + checks en Maps |
| 7 | `gorm_static` / `gorm_static_and` | `staticMatch` (solo dominios) |
| 8 | `domain_name` / `artifact_name` | `bareWordMatch` (letra mayúscula, sin punto) |
| 9 | `service_injection` | `/(\w+Service)\??\.(\w*)$/` |
| 10 | `gorm_instance` | `/([a-z]\w*)\??\.(\w*)$/` |
| 11 | `generic_grails` | fallback |

**⚠️ Trampa crítica del camelCase:** el regex `pkgDomainMatch` captura la última parte capitalizada de cualquier identificador. Para `fusionTokenService.`, captura `"TokenService"`. El check de camelCase verifica que el carácter inmediatamente antes del candidato no sea minúscula — si lo es, el match es un fragmento de camelCase y se ignora.

```typescript
// "fusionTokenService." → pkgDomainMatch captura "TokenService"
// lastChar antes de "TokenService" = "n" (minúscula) → isCamelCaseSplit = true → SKIP
// Cae al serviceMatch que captura "fusionTokenService" correctamente
const isCamelCaseSplit = /[a-z]/.test(lastChar); // true = es fragmento, ignorar
```

**⚠️ Trampas de bytes invisibles:** si el regex `serviceMatch` o `instanceMatch` deja de funcionar, verificar que no haya bytes de control (`\x08`, etc.) en el archivo fuente. Esto puede ocurrir al copiar código desde chats u otras fuentes. Diagnóstico:

```bash
python3 -c "
with open('server/src/completion.ts','rb') as f: d=f.read()
print('\\x08 count:', d.count(bytes([8])))
"
```

**Builders de completions** (una función por contexto):

| Función | Qué devuelve |
|---------|-------------|
| `importCompletions` | Paths de todos los artefactos del proyecto |
| `controllerNameCompletions` | Nombres simples de controllers |
| `actionNameCompletions` | `def accion()` del controller destino |
| `viewPathCompletions` | Archivos `.gsp` del directorio correspondiente |
| `domainNameCompletions` | Nombres de domain classes importadas |
| `gormStaticCompletions` | `findBy*`, `list`, `get`, `count`, etc. |
| `gormStaticAndCompletions` | Propiedades para encadenar `findByXAnd...` |
| `gormInstanceCompletions` | Propiedades + métodos de instancia GORM |
| `controllerMethodCompletions` | Métodos parseados del controller |
| `serviceMethodCompletions` | Métodos parseados del servicio (con fallback case-insensitive) |
| `artifactNameCompletions` | Nombres de controllers y servicios (sin punto en insertText) |
| `declaredServiceCompletions` | Servicios declarados en el archivo actual (comparación case-insensitive) |
| `controllerScopeCompletions` | `render`, `redirect`, `params`, `session`, etc. |
| `renderRedirectKeyCompletions` | `view:`, `model:`, `action:`, etc. |

**Parser de métodos** (`methodRe`):
```typescript
/^\s*(?:(?:private|protected|public)\s+)?(?:static\s+)?(?:def|\w+)\s+(\w+)\s*\(/gm
```
Soporta: `def foo(`, `Map foo(`, `public static String foo(`, `private Map foo(`. El `skip` set excluye: `class`, `if`, `for`, `while`, `switch`, `try`, `catch`, `return`, `static`, `final`, `new`.

---

### 4.3 `definition.ts` — Go-to-Definition

**Punto de entrada:**
```typescript
export function getDefinition(
    doc: TextDocument,
    params: TextDocumentPositionParams,
    project: GrailsProject | null
): Location | null
```

**Orden de resolución** en `getDefinition()`:

1. GSP: `resolveGspTag` (template, controller+action)
2. `render`: `resolveRenderView` + `resolveRenderTemplate`
3. `redirect`: `resolveRedirect` (mismo controller si no hay `controller:`)
4. Método de servicio: `resolveServiceMethod` — `/\b(\w+Service)\s*\??\.\s*(\w+)\s*\(/`
5. Variable de servicio: `resolveServiceInjection`
6a. Método de controller estático: `resolveControllerStaticCall` — busca en `controllers` **y** `services`
6b. Método GORM estático: `resolveGormStaticCall`
7. Propiedad de dominio: `resolveDomainProperty` (con inferencia de variable)
8. Artefacto por nombre: `resolveArtifactByName`
9. Método local: `resolveLocalMethod`

**Inferencia de tipo de variable** (`inferVariableType`): busca hacia arriba desde la línea del cursor para resolver `def area = Area.findBy...()` → tipo `Area`.

**Regex para buscar métodos en archivos de destino:**
```typescript
new RegExp(`(?:(?:private|protected|public)\\s+)?(?:static\\s+)?(?:def|\\w+)\\s+${methodName}\\s*\\(`)
```
Mismo patrón que en completion — soporta todos los modificadores.

---

### 4.4 `indexer.ts` — Watcher de archivos

```typescript
class GrailsIndexer {
    initialize(workspaceFolders: string[]): void  // busca raíz Grails y llama index()
    onFileChanged(changedPath: string): void       // debounce 300ms → re-index
    getProject(): GrailsProject | null
    dispose(): void
}
```

Escucha cambios en `grails-app/domain`, `grails-app/controllers`, `grails-app/services`, `grails-app/taglib`, y `src/main/groovy` (Grails 3+).

---

### 4.5 `server.ts` — Punto de entrada LSP

Registra las capacidades del servidor:
- `completionProvider` con `triggerCharacters: [".", "(", ":", "A"-"Z"]`
- `definitionProvider: true`

Los `triggerCharacters` con letras mayúsculas permiten que el autocompletado se active al empezar a escribir nombres de clase.

---

### 4.6 `uriUtils.ts` — Utilidades de URI

Cross-platform. Convierte entre paths del sistema de archivos y URIs LSP (`file:///`).

```typescript
export function pathToUri(fsPath: string): string   // "/home/x/Foo.groovy" → "file:///home/x/Foo.groovy"
export function uriToPath(uri: string): string      // inverso, maneja Windows ("C:/...")
```

**Nunca usar `uri.replace(/^file:\/\//, "")` directamente** — rompe en Windows.

---

## 5. Archivo del cliente VS Code

### 5.1 `extension.ts` — Cliente VS Code

**Responsabilidad:** todo lo que el usuario ve en la UI de VS Code.

#### Componentes principales

**`GrailsProjectProvider`** (TreeDataProvider)
- Árbol en la Activity Bar con la estructura del proyecto Grails
- Primer nodo: versión detectada (`Grails 2.5.6`)
- `dirKind()` asigna un `contextValue` específico a cada carpeta conocida (`grailsFolder_controllers`, `grailsFolder_domain`, etc.) para controlar el menú contextual
- Archivos (`grailsFile`) tienen `command: vscode.open` para abrir al hacer clic

**`GrailsGspCodeLensProvider`** (CodeLensProvider)
- Solo actúa en archivos `*Controller.groovy`
- Por cada `def accion()`, busca `grails-app/views/controllerName/accion.gsp` y muestra un CodeLens si existe

**`refactorPackagesInFolder(folderPath, oldPkg, newPkg)`**
- Escanea recursivamente todos los `.groovy` dentro de una carpeta
- Actualiza la línea `package` si coincide con `oldPkg` o es un sub-paquete de él
- Solo modifica la primera línea no-vacía no-comentario que empiece con `package`

**Templates de artefactos** — cada función recibe `(name: string, pkg: string, version?: string)`:
- `controllerTemplate` — igual en todas las versiones
- `domainTemplate` — igual en todas las versiones  
- `serviceTemplate` — varía según versión (ver tabla en CHANGELOG)
- `taglibTemplate`, `gspTemplate`

**`inferPackage(folderPath)`** — deriva el paquete Groovy a partir de la ruta, buscando los marcadores `grails-app/controllers`, `grails-app/services`, `src/main/groovy`, etc.

#### Menú contextual — `contextValue` y grupos

El menú contextual del árbol se configura en `package.json` bajo `view/item/context`. Los grupos controlan el orden y separadores:

| Grupo | Contenido |
|-------|-----------|
| `1_create@N` | Opción principal según tipo de carpeta (solo en carpeta específica) |
| `2_generic@N` | Nueva Carpeta, Nuevo Archivo (todas las carpetas) |
| `3_grails@N` | Todos los artefactos Grails (solo en carpetas genéricas `grailsFolder`) |
| `9_manage@N` | Renombrar, Eliminar (todos los nodos excepto versión y raíz) |

**Regla importante:** la opción específica (`createController` en `grailsFolder_controllers`) usa `viewItem == grailsFolder_controllers` (igualdad exacta). Las opciones genéricas usan `viewItem =~ /^grailsFolder/` (regex). Esto evita que aparezcan opciones de otros tipos en cada carpeta.

---

## 6. `package.json` — Contribuciones VS Code

Secciones relevantes:

```json
"contributes": {
    "viewsContainers": {
        "activitybar": [{ "id": "grailsExplorer", "icon": "images/grails-icon.svg" }]
    },
    "views": {
        "grailsExplorer": [{ "id": "grailsProjectExplorer", "name": "Grails Project" }]
    },
    "commands": [ ... ],
    "menus": {
        "view/item/context": [ ... ],
        "commandPalette": [ ... ]
    }
}
```

Los comandos del menú contextual tienen `"when": "false"` en `commandPalette` para no contaminar la paleta de comandos.

---

## 7. Flujo de datos completo

### Autocompletado cuando se escribe `fusionTokenService.`

```
Usuario escribe "."
    │
    ▼
VS Code detecta triggerCharacter "."
    │
    ▼
extension.ts (cliente) → LSP request: textDocument/completion
    │
    ▼
server.ts: onCompletion()
    │  doc = documentos.get(uri)
    │  project = indexer.getProject()
    │
    ▼
completion.ts: getCompletions(doc, params, project)
    │
    ▼
detectContext():
    │  lineUpTo = "    def x = fusionTokenService."
    │  pkgDomainMatch → "TokenService" → camelCase check → SKIP
    │  serviceMatch → "fusionTokenService" → return service_injection
    │
    ▼
serviceMethodCompletions("fusionTokenService", project):
    │  capitalize → "FusionTokenService"
    │  project.services.get("FusionTokenService") → artifact
    │  fs.readFileSync(artifact.filePath)
    │  methodRe.exec(src) → [validateToken, getToken, clearCache, ...]
    │
    ▼
CompletionItem[] → LSP response → VS Code muestra lista
```

### Go-to-Definition cuando cursor está en `registerMember`

```
Usuario Ctrl+Click en "registerMember"
    │
    ▼
extension.ts → LSP request: textDocument/definition
    │
    ▼
definition.ts: getDefinition(doc, params, project)
    │
    ▼
resolveServiceMethod(word="registerMember", line, project):
    │  serviceCallMatch → serviceVar="securityService", methodName="registerMember"
    │  word === methodName ✓
    │  capitalize → "SecurityService"
    │  project.services.get("SecurityService") → artifact
    │  scan lines: /(?:public|...)?(?:static\s+)?(?:def|\w+)\s+registerMember\s*\(/
    │  → line 47
    │
    ▼
Location { uri: "file:///...SecurityService.groovy", range: { line: 47 } }
    │
    ▼
VS Code abre el archivo en la línea exacta
```

---

## 8. Estándares y convenciones

### TypeScript

- **Sin `any` implícito** — siempre tipar o usar `unknown`
- **Funciones puras** para builders de completions — sin efectos secundarios
- **`null` sobre `undefined`** para valores ausentes en interfaces públicas
- Template literals para strings con interpolación; strings normales para literales simples

### Regexes

- **Siempre testear en Node.js antes de integrar**, especialmente cuando se usan en `new RegExp(templateLiteral)` — los escapes se duplican (`\\s` en TS → `\s` en runtime)
- **Nunca usar `\b` en template literals de RegExp** — se convierte en `\x08` (backspace). Usar `(?:^|\s)` o `(?<![\\w])` según el caso
- Para regex en template literals: `\\w` en la fuente → `\w` en runtime ✓

```typescript
// ✅ Correcto en template literal
new RegExp(`(?:def|\\w+)\\s+${methodName}\\s*\\(`)

// ❌ Incorrecto — \b se vuelve \x08
new RegExp(`\\b${methodName}\\s*\\(`)
```

### Orden de contextos en `detectContext`

El orden importa. Regla general: **más específico antes que más genérico**. Si cambias el orden, verifica los casos:
1. `fusionTokenService.` — debe llegar a `serviceMatch`, no quedarse en `pkgDomainMatch`
2. `Book.` (importado) — debe llegar a `gorm_static`, no a `artifact_name`
3. `def sw = SwaggerController` — debe llegar a `artifact_name`, no a `domain_name`
4. `render(view: "` — debe llegar a `string_view`, no a `render_redirect_key`

### `package.json` menús

- `viewItem == X` (igualdad exacta) para opciones específicas de una carpeta
- `viewItem =~ /^grailsFolder/` (regex) para opciones genéricas en todas las carpetas de Grails
- Nunca usar `=~ /grailsFolder/` sin `^` — matchearía `grailsFile` accidentalmente si se añaden nuevos tipos en el futuro

### Creación de artefactos

- **Siempre escribir directamente al disco** (`fs.writeFileSync`) — no usar `grails create-*` CLI
- Verificar que el archivo no existe antes de crear (`fs.existsSync`)
- Llamar `treeProvider.refresh()` después de crear/renombrar/eliminar
- Usar `fs.mkdirSync(dir, { recursive: true })` para crear subdirectorios automáticamente

---

## 9. Bugs conocidos y soluciones aplicadas

### `\x08` en regexes — el más importante

**Síntoma:** `serviceMatch` o `instanceMatch` siempre devuelven `null`. El log muestra `kind=generic_grails` incluso cuando la línea contiene claramente un servicio con punto.

**Causa:** un byte `\x08` (backspace, ASCII 8) se coló en el archivo `.ts` al copiar código desde un chat o editor que convirtió `\b` (word boundary) en el carácter de control correspondiente. TypeScript lo compila eliminando la `/` de apertura del regex literal, generando JS inválido.

**Diagnóstico:**
```bash
python3 -c "
with open('server/src/completion.ts','rb') as f: d=f.read()
idx = d.find(bytes([8]))
while idx >= 0:
    print(f'byte 0x08 at {idx}:', d[idx-20:idx+20])
    idx = d.find(bytes([8]), idx+1)
"
```

**Fix:**
```python
content = content.replace(b'/\x08(\w+Service)', b'/(\w+Service)')
content = content.replace(b'/\x08([a-z]\w*)', b'/([a-z]\w*)')
```

### Doble punto al autocompletar nombre de clase

**Síntoma:** al seleccionar `TestService` del autocompletado, aparece `TestService..`

**Causa:** `artifactNameCompletions` tenía `insertText: name + "."`. Si el usuario ya había escrito el punto (trigger), VS Code insertaba el texto sobre lo ya escrito resultando en doble punto.

**Fix:** `insertText: name` (sin punto). El `commitCharacters: ["."]` maneja el caso de selección con `.`.

### camelCase splitting en servicios multi-palabra

**Síntoma:** `fusionTokenService.` no muestra métodos de `FusionTokenService` sino de `TokenService` (si existe).

**Causa:** `pkgDomainMatch` captura el último segmento capitalizado (`TokenService`) y si hay un servicio con ese nombre, retorna temprano con la instancia incorrecta.

**Fix:** verificar que el carácter antes del candidato no sea minúscula antes de usarlo como nombre de clase completo.

### Métodos `public static` no parseados

**Síntoma:** servicios con métodos Java-style (`public static String sendGet(`) no mostraban esos métodos en el autocompletado.

**Causa:** el `methodRe` original solo tenía un grupo opcional para `private|protected|public` y luego `(?:def|\w+)`, lo que hacía que `static` se capturara como "tipo de retorno" y el nombre real no se encontrara.

**Fix:** `(?:(?:private|protected|public)\s+)?(?:static\s+)?` — dos grupos opcionales separados.

---

## 10. Cómo agregar una nueva feature

### Nuevo tipo de autocompletado

1. Agregar el nuevo `kind` al type `CompletionKind` en `completion.ts`
2. Agregar campos opcionales al interface `CompletionContext` si es necesario
3. Agregar la detección en `detectContext()` en el orden correcto
4. Crear la función builder `miNuevoContextCompletions()`
5. Agregar el `case` en el `switch` de `getCompletions()`
6. Verificar que no rompe los casos existentes (especialmente los camelCase)

### Nueva resolución de definición

1. Crear función `resolveAlgo(word, line, project): Location | null`
2. Agregar la llamada en `getDefinition()` en el orden apropiado
3. Si usa `new RegExp(template)`, verificar los escapes dobles

### Nuevo tipo de artefacto en el árbol

1. Agregar el `NodeKind` en `extension.ts`
2. Agregar en `dirKind()` el mapeo `folderName → NodeKind`
3. Agregar en `dirIcon()` el ícono correspondiente
4. Agregar en `package.json` el `contextValue` en los menús
5. Registrar el comando en `registerContextCommands()`

---

## 11. Compilación y desarrollo

### Setup inicial

```bash
git clone https://github.com/Johan070119/Grails-VsCode-Extension
cd grails-vscode-extension
npm install
cd server && npm install && cd ..
```

### Ciclo de desarrollo

```bash
# Compilar todo
npx tsc -p tsconfig.json
cd server && npx tsc -p tsconfig.json && cd ..

# Compilar solo el servidor (el más frecuente)
cd server && rm -rf dist/ && npx tsc -p tsconfig.json

# En VS Code: recargar después de cambios
Ctrl+Shift+P → Developer: Reload Window
```

### Ver logs del servidor

```
VS Code → Ver → Output → Grails Language Server
```

El servidor loguea:
- `[Grails] Project found at: /ruta`
- `[Grails] Indexed (v2) — 80 domains, 3 controllers, 22 services, 0 taglibs`
- `[Grails] Re-indexing after change: ArchivoModificado.groovy`
- Errores de request (`[Error] Request textDocument/completion failed`)

### Agregar logging temporal para debug

En `completion.ts`, dentro de `getCompletions()`, **usar `process.stderr.write`** (no `console.log` ni backticks):

```typescript
process.stderr.write("[DEBUG] kind=" + ctx.kind + " line=" + lineUpTo + "\n");
```

Los backticks en template literals dentro del servidor LSP pueden causar errores de compilación si hay caracteres especiales. Siempre usar concatenación de strings para logs de debug.

---

*Documentación generada el 16 de marzo de 2026. Versión del proyecto: 0.4.0*
