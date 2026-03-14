# Grails Dev Tools for VS Code

![Grails](https://img.shields.io/badge/Grails-6.x-green)
![VS Code](https://img.shields.io/badge/VS%20Code-1.80+-blue)
![License](https://img.shields.io/badge/License-Apache%202.0-blue)

Soporte avanzado para el desarrollo de aplicaciones Grails en Visual Studio Code, inspirado en la experiencia de IntelliJ IDEA.

## Características

### ✨ Fase Temprana - Funcionalidades Actuales

#### 📝 Autocompletado Inteligente
- **Domain Classes**: Autocompletado de propiedades y métodos en dominios GORM
- **Controllers**: Sugerencias de acciones, vistas y servicios
- **Services**: Inyección automática y métodos disponibles
- **GSP Views**: Sugerencias de tags y variables en vistas

```groovy
// Autocompletado en Controller
class BookController {
    def bookService  // Autocompletado al escribir 'book'
    
    def index() {
        def books = bookService.  // Muestra métodos disponibles
    }
}
```

#### 🔍 Navegación (Ctrl+Click / Cmd+Click)
- Navega directamente a la definición de:
  - **Controllers** desde URL Mappings
  - **Domain Classes** desde queries y relaciones
  - **Services** desde puntos de inyección
  - **GSP Views** desde renders y redirects
  - **TagLibs** desde tags personalizados

```groovy
// Ctrl+Click en 'Book' navega al Domain Class
class BookController {
    def list() {
        [books: Book.list()]  // ← Click en Book
    }
}

// Ctrl+Click en 'list' navega a la vista GSP
render(view: "list", model: [books: books])  // ← Click en "list"
```

#### 🏗️ Estructura de Proyecto
- Reconocimiento automático de estructura Grails
- Soporte para múltiples módulos/plugins
- Indexación de componentes del proyecto

### 🚧 Próximamente

- **Refactorización**: Renombrar domain classes, controllers y vistas
- **Run/Debug**: Lanzar aplicación Grails desde VS Code
- **GORM Queries**: Resaltado de sintaxis y validación de criterios

## Requisitos

- VS Code 1.80.0 o superior
- Proyecto Grails 2.x, 3.x, 4.x, 5.x o 6.x
- Java 8, 11 o superior

## Instalación

### Desde VS Code Marketplace
1. Abre VS Code
2. Ve a Extensiones (Ctrl+Shift+X / Cmd+Shift+X)
3. Busca "Grails-VsCode-Extension"
4. Haz clic en Instalar

### Desde VSIX
```bash
code --install-extension Grails-VsCode-Extension-0.1.0.vsix
```

## Uso

### Activación
La extensión se activa automáticamente al abrir cualquier proyecto que contenga:
- Archivo `application.yml` o `application.groovy`
- Carpeta `grails-app/`

## Estructura de Proyecto

La extensión reconoce y trabaja con la estructura estándar de Grails:

```
proyecto-grails/
├── grails-app/
│   ├── controllers/
│   ├── domain/
│   ├── services/
│   ├── views/
│   └── taglib/
├── src/
│   ├── main/groovy/
│   └── test/groovy/
├── application.yml
└── build.gradle
```

## Desarrollo de la Extensión

### Construir desde código fuente

```bash
# Clonar repositorio
git clone https://github.com/tu-usuario/Grails-VsCode-Extension

# Instalar dependencias
npm install

# Compilar
npm run compile

# Ejecutar pruebas
npm run test
```

### Empaquetar

```bash
# Instalar vsce
npm install -g @vscode/vsce

# Empaquetar extensión
vsce package
```

## Reportar Problemas

Si encuentras algún bug o tienes sugerencias:
- [Reportar en GitHub Issues](https://github.com/tu-usuario/Grails-VsCode-Extension/issues)
- Incluye logs de la extensión (View → Output → Grails Language Server)

## Contribuir

¡Las contribuciones son bienvenidas!

1. Fork el proyecto
2. Crea tu rama de feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## Licencia

Apache 2.0 - Ver [LICENSE](LICENSE) para más detalles.
