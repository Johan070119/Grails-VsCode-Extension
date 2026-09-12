# Plan de implementación actualizado

Este plan sustituye el plan inicial y refleja el estado real después del primer
hito de implementación. La prioridad continúa siendo Grails 7.1.x, manteniendo
Grails 2.5.6 como carril de regresión. La extensión de Zed queda fuera de alcance.

## Principios de arquitectura

1. El servidor TypeScript conserva el conocimiento específico de Grails: artefactos,
   GORM, convenciones MVC, GSP y navegación cruzada.
2. El servidor JVM aporta semántica real de Groovy/Java: AST, tipos, firmas,
   referencias, rename y diagnósticos.
3. Gradle proporciona classpath y source sets; nunca se ejecuta código del proyecto
   en un workspace no confiable.
4. Cada capacidad nueva debe probarse primero en Grails 7.1.1 y luego contra la
   regresión de Grails 2.5.6 cuando corresponda.

## Fase 0 — base verificable y seguridad (casi terminada)

Terminado: compilación separada cliente/servidor, pruebas Node, CI multiplataforma,
regresiones 2.5.6/7.1.1, Workspace Trust, rutas seguras y licencia Apache-2.0.

Pendiente:

- pruebas reales con VS Code Extension Host;
- matriz de compatibilidad por función y versión;
- política de telemetría: por defecto ninguna, salvo decisión explícita futura.

## Fase 1 — modelo de proyecto Grails (núcleo terminado)

Terminado: versión exacta, multi-root, source roots modernos y legacy, índice
incremental Groovy/Java, nombres cualificados, dependencias directas, caché y
ejecución wrapper-first.

Añadido en este corte: bridge Gradle controlado que resuelve classpath transitivo y
source sets mediante `gradlew` y un init script sin modificar el proyecto. El bridge
usa el JDK semántico configurado para no depender del Java global de VS Code.

Pendiente:

- caché persistente del modelo Gradle por fingerprint del build;
- invalidación cuando cambien build scripts, catálogos o plugins;
- evaluar Gradle Tooling API frente al bridge actual con métricas reales.

## Fase 2 — núcleo semántico Groovy/Java (en progreso)

Terminado: spike JVM, adaptador multi-root opt-in, índice puente de tipos/miembros,
completion, definition, hover y símbolos básicos. El build del servidor JVM está
anclado por commit y SHA-256.

Siguiente entrega:

- comprobar automáticamente que el VSIX contiene el JAR verificado y sus licencias;
- fusionar y deduplicar respuestas TypeScript/JVM;
- activar signature help, references, rename y diagnósticos compiler-backed;
- cancelación, límites de memoria, reinicio y pruebas de rendimiento.

## Fase 3 — semántica Grails 7 y GORM

- reconocer Domain, Service, Controller, Command Object, TagLib y artefactos de plugins;
- tipos inyectados (`params`, `request`, servicios, `grailsApplication`, etc.);
- métodos GORM estáticos/de instancia, dynamic finders y validación de propiedades;
- where queries, criteria builders, data services, constraints y mappings;
- inferencia de asociaciones, colecciones, nullable y validadores;
- documentación contextual proveniente de la versión detectada.

## Fase 4 — GSP, HTML, JavaScript y CSS

- documentos virtuales GSP que preserven HTML/CSS/JS embebido;
- completado de tags Grails y atributos tipados;
- navegación controller/action/view/template y taglib;
- navegación de recursos estáticos, assets y layouts;
- diagnósticos de tags, expresiones y referencias inexistentes.

## Fase 5 — navegación y refactorización transversal

- Ctrl/Cmd+Click entre artefactos, Java, Groovy, GSP y recursos;
- Find References y Call Hierarchy conscientes de convenciones Grails;
- rename seguro de clases, artefactos, actions, views y paquetes;
- CodeLens, breadcrumbs, outline e indicadores de relaciones MVC.

## Fase 6 — ejecución, debug, pruebas y generación

- run/debug con Grails CLI o Gradle Wrapper por proyecto;
- task provider y configuraciones de depuración reproducibles;
- explorador de pruebas unitarias, integración y Geb/Spock;
- creación/scaffolding de artefactos con templates específicos por versión;
- acciones de actualización de dependencias y diagnóstico del entorno.

## Fase 7 — ecosistema de plugins Grails

- importar catálogo oficial y metadatos locales del build;
- completion/documentación aportada por plugins instalados;
- SPI versionada para que plugins contribuyan tags, DSLs y artefactos;
- caché offline y compatibilidad por versión de Grails.

## Fase 8 — compatibilidad y migración

- Grails 6.x estable después de consolidar 7.1.x;
- Grails 3–5 en modo compatibilidad probado;
- conservar 2.5.6 sin frenar la arquitectura moderna;
- preparar Grails 8 cuando existan artefactos y documentación estables;
- diagnósticos opcionales de migración separados de las funciones del editor.

## Fase 9 — calidad y publicación

- corpus de proyectos fixture y pruebas end-to-end por plataforma;
- presupuestos de latencia, memoria y tamaño del VSIX;
- pruebas de actualización, Restricted Mode y fallos de Gradle/JDK;
- versionado semántico, changelog, SBOM, firmas y publicación automatizada;
- documentación de contribución y arquitectura para extensiones de terceros.

## Criterio de paridad y superación

La paridad con IntelliJ se medirá por escenarios reproducibles, no por cantidad de
features anunciadas. Una función se considera lista cuando funciona en un proyecto
Grails 7.1.x real, tiene prueba automatizada, degrada limpiamente sin Gradle/JDK y
no rompe el carril legacy que corresponda. Superar la referencia significa además
ofrecer multi-root, operación transparente, apertura del protocolo de extensiones y
diagnósticos accionables específicos de Grails.
