import * as fs from "fs";
import * as path from "path";
import {
    CompletionItem,
    CompletionItemKind,
    Diagnostic,
    DiagnosticSeverity,
    Hover,
    InsertTextFormat,
    Location,
    MarkupKind,
    Position,
    Range,
    SymbolInformation,
    SymbolKind,
    TextDocumentPositionParams,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { GrailsProject } from "./grailsProject";
import { pathToUri, uriToPath } from "./uriUtils";

interface TagSpec {
    description: string;
    attributes: string[];
    required?: string[];
}

const COMMON_LINK_ATTRIBUTES = [
    "action", "controller", "resource", "namespace", "plugin", "id",
    "params", "mapping", "method", "uri", "url", "absolute", "base",
    "fragment", "elementId",
];

export const GSP_TAGS: Record<string, TagSpec> = {
    "g:link": { description: "Generates a Grails-aware HTML link.", attributes: COMMON_LINK_ATTRIBUTES },
    "g:createLink": { description: "Creates a Grails URL.", attributes: COMMON_LINK_ATTRIBUTES },
    "g:form": { description: "Creates a form targeting a controller action.", attributes: [...COMMON_LINK_ATTRIBUTES, "name", "useToken", "method"] },
    "g:uploadForm": { description: "Creates a multipart form.", attributes: [...COMMON_LINK_ATTRIBUTES, "name", "useToken"] },
    "g:formActionSubmit": { description: "Submits a Grails form to an action.", attributes: ["value", "action", "controller", "name"], required: ["value", "action"] },
    "g:render": { description: "Renders a reusable GSP template.", attributes: ["template", "bean", "model", "collection", "var", "plugin", "contextPath", "optional"], required: ["template"] },
    "g:include": { description: "Includes another controller action or view.", attributes: ["controller", "action", "view", "id", "model", "params"] },
    "g:applyLayout": { description: "Applies a SiteMesh layout.", attributes: ["name", "template", "url", "controller", "action", "contentType", "encoding", "params"], required: ["name"] },
    "g:layoutHead": { description: "Renders the decorated page head.", attributes: [] },
    "g:layoutBody": { description: "Renders the decorated page body.", attributes: [] },
    "g:layoutTitle": { description: "Renders the decorated page title.", attributes: ["default"] },
    "g:pageProperty": { description: "Reads a SiteMesh page property.", attributes: ["name", "default", "writeEntireProperty"], required: ["name"] },
    "g:each": { description: "Iterates over a collection.", attributes: ["in", "var", "status"] },
    "g:collect": { description: "Collects values from a collection.", attributes: ["in", "expr"] },
    "g:findAll": { description: "Filters a collection.", attributes: ["in", "expr"] },
    "g:grep": { description: "Filters a collection by pattern or type.", attributes: ["in", "filter"] },
    "g:while": { description: "Renders its body while the test is true.", attributes: ["test"], required: ["test"] },
    "g:if": { description: "Conditional rendering.", attributes: ["test", "env"], required: ["test"] },
    "g:elseif": { description: "Conditional alternative.", attributes: ["test", "env"], required: ["test"] },
    "g:else": { description: "Conditional fallback.", attributes: [] },
    "g:unless": { description: "Renders unless a condition is true.", attributes: ["test"], required: ["test"] },
    "g:set": { description: "Defines a page variable or property.", attributes: ["var", "value", "scope", "bean", "field"] },
    "g:message": { description: "Resolves an i18n message.", attributes: ["code", "error", "message", "args", "default", "encodeAs"] },
    "g:meta": { description: "Renders application metadata.", attributes: ["name"], required: ["name"] },
    "g:field": { description: "Renders an HTML input.", attributes: ["name", "type", "value", "required", "disabled", "readonly", "min", "max", "step"], required: ["name"] },
    "g:textField": { description: "Renders a text input.", attributes: ["name", "value", "class", "id", "required", "disabled", "readonly"], required: ["name"] },
    "g:passwordField": { description: "Renders a password input.", attributes: ["name", "value", "class", "id", "required", "disabled"], required: ["name"] },
    "g:hiddenField": { description: "Renders a hidden input.", attributes: ["name", "value", "id"], required: ["name"] },
    "g:textArea": { description: "Renders a textarea.", attributes: ["name", "value", "rows", "cols", "class", "id", "required", "disabled", "readonly"], required: ["name"] },
    "g:checkBox": { description: "Renders a checkbox.", attributes: ["name", "value", "checked", "id", "disabled"], required: ["name"] },
    "g:radio": { description: "Renders a radio input.", attributes: ["name", "value", "checked", "id", "disabled"], required: ["name", "value"] },
    "g:radioGroup": { description: "Renders a group of radio inputs.", attributes: ["name", "values", "labels", "value"], required: ["name", "values"] },
    "g:select": { description: "Renders an HTML select.", attributes: ["name", "from", "value", "optionKey", "optionValue", "noSelection", "multiple", "valueMessagePrefix"], required: ["name", "from"] },
    "g:datePicker": { description: "Renders date selection controls.", attributes: ["name", "value", "precision", "years", "relativeYears", "noSelection", "default"] },
    "g:submitButton": { description: "Renders a submit button.", attributes: ["name", "value", "class", "id"], required: ["name"] },
    "g:fieldValue": { description: "Renders a bean property value.", attributes: ["bean", "field"], required: ["bean", "field"] },
    "g:fieldError": { description: "Renders one validation error.", attributes: ["bean", "field", "error", "encodeAs"] },
    "g:eachError": { description: "Iterates over validation errors.", attributes: ["bean", "field", "model", "var"] },
    "g:hasErrors": { description: "Renders when validation errors exist.", attributes: ["bean", "field", "model"] },
    "g:renderErrors": { description: "Renders validation errors.", attributes: ["bean", "field", "as", "class"] },
    "g:paginate": { description: "Renders pagination controls.", attributes: ["total", "max", "offset", "controller", "action", "id", "params", "prev", "next", "maxsteps"], required: ["total"] },
    "g:sortableColumn": { description: "Renders a sortable table header.", attributes: ["property", "title", "titleKey", "params", "action", "defaultOrder"], required: ["property"] },
    "g:formatDate": { description: "Formats a date.", attributes: ["date", "format", "formatName", "type", "style", "timeStyle", "locale", "timeZone"], required: ["date"] },
    "g:formatNumber": { description: "Formats a number.", attributes: ["number", "format", "type", "currencyCode", "currencySymbol", "locale", "maxFractionDigits", "minFractionDigits"], required: ["number"] },
    "g:resource": { description: "Builds a static resource URL.", attributes: ["dir", "file", "plugin", "absolute", "base"], required: ["file"] },
    "g:javascript": { description: "Includes a JavaScript resource.", attributes: ["src", "plugin", "library"] },
    "g:img": { description: "Renders an image resource.", attributes: ["dir", "file", "src", "alt", "width", "height", "class"] },
    "asset:stylesheet": { description: "Includes an Asset Pipeline stylesheet.", attributes: ["src", "media"], required: ["src"] },
    "asset:javascript": { description: "Includes an Asset Pipeline script.", attributes: ["src"], required: ["src"] },
    "asset:image": { description: "Renders an Asset Pipeline image.", attributes: ["src", "alt", "width", "height", "class"], required: ["src"] },
    "asset:assetPath": { description: "Returns an Asset Pipeline resource path.", attributes: ["src"], required: ["src"] },
};

const HTML_TAGS = ["html", "head", "title", "meta", "link", "body", "header", "main", "nav", "section", "article", "aside", "footer", "div", "span", "p", "a", "img", "form", "label", "input", "button", "select", "option", "textarea", "table", "thead", "tbody", "tr", "th", "td", "ul", "ol", "li", "script", "style"];
const HTML_ATTRIBUTES = ["id", "class", "style", "title", "name", "value", "type", "href", "src", "alt", "role", "method", "action", "target", "rel", "media", "placeholder", "required", "disabled", "readonly", "checked", "selected", "multiple", "data-", "aria-"];

function textBefore(document: TextDocument, position: Position): string {
    return document.getText().slice(0, document.offsetAt(position));
}

function activeTag(before: string): string | null {
    const start = before.lastIndexOf("<");
    if (start < 0 || before.lastIndexOf(">") > start) return null;
    return before.slice(start);
}

function customTags(project: GrailsProject): Map<string, { filePath: string; line: number }> {
    const result = new Map<string, { filePath: string; line: number }>();
    for (const taglib of project.taglibs.values()) {
        let source = "";
        try { source = fs.readFileSync(taglib.filePath, "utf8"); } catch { continue; }
        const namespace = /static\s+namespace\s*=\s*['"]([\w-]+)['"]/.exec(source)?.[1] ?? "g";
        source.split("\n").forEach((line, index) => {
            const match = /^\s*(?:def|Closure)\s+([A-Za-z_]\w*)\s*=\s*\{/.exec(line);
            if (match) result.set(`${namespace}:${match[1]}`, { filePath: taglib.filePath, line: index });
        });
    }
    return result;
}

function controllerForView(filePath: string, project: GrailsProject): string | null {
    const relative = path.relative(path.join(project.root, "grails-app", "views"), filePath).replace(/\\/g, "/");
    const segment = relative.split("/")[0];
    if (!segment || segment === "layouts") return null;
    return segment.charAt(0).toUpperCase() + segment.slice(1) + "Controller";
}

function actionItems(tag: string, filePath: string, project: GrailsProject): CompletionItem[] {
    const explicit = /\bcontroller\s*=\s*['"]([\w-]+)['"]/.exec(tag)?.[1];
    const controllerName = explicit
        ? explicit.charAt(0).toUpperCase() + explicit.slice(1) + "Controller"
        : controllerForView(filePath, project);
    const artifact = controllerName ? project.controllers.get(controllerName) : null;
    if (!artifact) return [];
    let source = "";
    try { source = fs.readFileSync(artifact.filePath, "utf8"); } catch { return []; }
    return [...source.matchAll(/^\s*(?:def|[A-Za-z_$][\w.$<>?]*)\s+([A-Za-z_]\w*)\s*\(/gm)].map((match) => ({
        label: match[1], kind: CompletionItemKind.Method, detail: `${artifact.name} action`, insertText: match[1],
    }));
}

function walkFiles(root: string, extensions: string[], limit = 500): string[] {
    if (!fs.existsSync(root)) return [];
    const result: string[] = [];
    const visit = (dir: string) => {
        if (result.length >= limit) return;
        let entries: fs.Dirent[] = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            if (result.length >= limit) break;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) visit(full);
            else if (extensions.some((ext) => entry.name.endsWith(ext))) result.push(full);
        }
    };
    visit(root);
    return result;
}

function pathItems(root: string, extensions: string[], kind: CompletionItemKind, stripTemplate = false): CompletionItem[] {
    return walkFiles(root, extensions).map((file) => {
        let label = path.relative(root, file).replace(/\\/g, "/");
        if (stripTemplate) label = label.replace(/(^|\/)_(?=[^/]+$)/, "$1").replace(/\.gsp$/, "");
        return { label, kind, detail: file, insertText: label };
    });
}

function valueCompletions(attribute: string, tag: string, filePath: string, project: GrailsProject): CompletionItem[] {
    if (attribute === "controller") return [...project.controllers.values()].map((item) => ({ label: item.simpleName, kind: CompletionItemKind.Class, detail: item.name }));
    if (attribute === "action") return actionItems(tag, filePath, project);
    const views = path.join(project.root, "grails-app", "views");
    if (attribute === "template") return pathItems(views, [".gsp"], CompletionItemKind.File, true).filter((item) => path.basename(String(item.detail)).startsWith("_"));
    if (attribute === "view") return pathItems(views, [".gsp"], CompletionItemKind.File).map((item) => ({ ...item, label: String(item.label).replace(/\.gsp$/, ""), insertText: String(item.label).replace(/\.gsp$/, "") }));
    if (attribute === "name" && /(?:applyLayout|meta\s+name)/.test(tag)) {
        return pathItems(path.join(views, "layouts"), [".gsp"], CompletionItemKind.File).map((item) => ({ ...item, label: String(item.label).replace(/\.gsp$/, ""), insertText: String(item.label).replace(/\.gsp$/, "") }));
    }
    if (["src", "href", "file"].includes(attribute)) {
        const roots = [path.join(project.root, "grails-app", "assets"), path.join(project.root, "web-app"), path.join(project.root, "src", "main", "resources", "public")];
        return roots.flatMap((root) => pathItems(root, [".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".woff", ".woff2"], CompletionItemKind.File));
    }
    if (["absolute", "optional", "required", "disabled", "readonly", "checked", "multiple", "useToken"].includes(attribute))
        return ["true", "false"].map((value) => ({ label: value, kind: CompletionItemKind.Value }));
    if (attribute === "method") return ["GET", "POST", "PUT", "PATCH", "DELETE"].map((value) => ({ label: value, kind: CompletionItemKind.EnumMember }));
    return [];
}

export function getGspCompletions(document: TextDocument, params: TextDocumentPositionParams, project: GrailsProject): CompletionItem[] | null {
    if (!uriToPath(document.uri).endsWith(".gsp")) return null;
    const before = textBefore(document, params.position);
    const tag = activeTag(before);
    if (!tag) return null;

    const value = /\b([\w-]+)\s*=\s*['"]([^'"]*)$/.exec(tag);
    if (value) return valueCompletions(value[1], tag, uriToPath(document.uri), project);

    if (/^<\/?[\w:-]*$/.test(tag)) {
        const custom = [...customTags(project).keys()];
        return [
            ...Object.entries(GSP_TAGS).map(([name, spec]) => ({ label: name, kind: CompletionItemKind.Function, detail: spec.description, insertText: `${name}>\${1}</${name}>`, insertTextFormat: InsertTextFormat.Snippet })),
            ...custom.map((name) => ({ label: name, kind: CompletionItemKind.Function, detail: "Project TagLib tag", insertText: `${name}>\${1}</${name}>`, insertTextFormat: InsertTextFormat.Snippet })),
            ...HTML_TAGS.map((name) => ({ label: name, kind: CompletionItemKind.Keyword, detail: "HTML element", insertText: `${name}>\${1}</${name}>`, insertTextFormat: InsertTextFormat.Snippet })),
        ];
    }

    const tagName = /^<\/?([\w:-]+)/.exec(tag)?.[1];
    if (tagName && !/["'](?:[^"']*)$/.test(tag)) {
        const custom = customTags(project);
        const spec = GSP_TAGS[tagName];
        const attributes = spec?.attributes ?? (custom.has(tagName) ? ["bean", "model", "collection", "var"] : HTML_ATTRIBUTES);
        const used = new Set([...tag.matchAll(/\s([\w-]+)\s*=/g)].map((match) => match[1]));
        return attributes.filter((name) => !used.has(name)).map((name) => ({
            label: name,
            kind: CompletionItemKind.Property,
            detail: spec?.required?.includes(name) ? `Required attribute of <${tagName}>` : `Attribute of <${tagName}>`,
            insertText: `${name}="\${1}"`,
            insertTextFormat: InsertTextFormat.Snippet,
        }));
    }
    return null;
}

function location(filePath: string, line = 0): Location {
    return { uri: pathToUri(filePath), range: Range.create(Position.create(line, 0), Position.create(line, 0)) };
}

function existing(candidates: string[]): string | null {
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export function getGspDefinition(document: TextDocument, params: TextDocumentPositionParams, project: GrailsProject): Location | null {
    const filePath = uriToPath(document.uri);
    if (!filePath.endsWith(".gsp")) return null;
    const line = document.getText().split("\n")[params.position.line] ?? "";
    const cursor = params.position.character;
    const viewsRoot = path.join(project.root, "grails-app", "views");

    const customName = /<\/?([\w-]+:[\w-]+)/.exec(line)?.[1];
    const custom = customName ? customTags(project).get(customName) : null;
    if (custom) return location(custom.filePath, custom.line);

    const layout = /(?:<meta\s+name=['"]layout['"]\s+content|<g:applyLayout\b[^>]*\bname)\s*=\s*['"]([^'"]+)['"]/.exec(line)?.[1];
    if (layout) {
        const candidate = path.join(viewsRoot, "layouts", `${layout}.gsp`);
        if (fs.existsSync(candidate)) return location(candidate);
    }

    const template = /\btemplate\s*=\s*['"]([^'"]+)['"]/.exec(line)?.[1];
    if (template) {
        const logical = template.replace(/\.gsp$/, "");
        const relative = logical.replace(/^\//, "").split("/");
        relative[relative.length - 1] = `_${relative[relative.length - 1].replace(/^_/, "")}.gsp`;
        const candidate = existing([
            ...(logical.startsWith("/") ? [] : [path.join(path.dirname(filePath), ...relative)]),
            path.join(viewsRoot, ...relative),
        ]);
        if (candidate) return location(candidate);
    }

    const assetValue = /\b(?:src|href|file)\s*=\s*['"]([^'"$]+)['"]/.exec(line)?.[1];
    if (assetValue) {
        const dir = /\bdir\s*=\s*['"]([^'"]+)['"]/.exec(line)?.[1];
        const relative = path.join(dir ?? "", assetValue.replace(/^\//, ""));
        const candidate = existing([
            path.join(project.root, "grails-app", "assets", relative),
            path.join(project.root, "web-app", relative),
            path.join(project.root, "src", "main", "resources", "public", relative),
        ]);
        if (candidate) return location(candidate);
    }

    const controller = /\bcontroller\s*=\s*['"]([\w-]+)['"]/.exec(line)?.[1];
    const action = /\baction\s*=\s*['"]([\w-]+)['"]/.exec(line)?.[1];
    const controllerName = controller
        ? controller.charAt(0).toUpperCase() + controller.slice(1) + "Controller"
        : controllerForView(filePath, project);
    const artifact = controllerName ? project.controllers.get(controllerName) : null;
    if (artifact) {
        const controllerAttribute = /\bcontroller\s*=\s*['"]([\w-]+)['"]/.exec(line);
        const actionAttribute = /\baction\s*=\s*['"]([\w-]+)['"]/.exec(line);
        const onController = controllerAttribute?.index != null && cursor >= controllerAttribute.index && cursor <= controllerAttribute.index + controllerAttribute[0].length;
        const onAction = actionAttribute?.index != null && cursor >= actionAttribute.index && cursor <= actionAttribute.index + actionAttribute[0].length;
        if (!action || onController) return location(artifact.filePath);
        let source = "";
        try { source = fs.readFileSync(artifact.filePath, "utf8"); } catch { return location(artifact.filePath); }
        const lines = source.split("\n");
        const actionLine = lines.findIndex((candidate) => new RegExp(`\\b${action}\\s*\\(`).test(candidate));
        if (onAction || action) return location(artifact.filePath, Math.max(0, actionLine));
    }

    return null;
}

export function getGspHover(document: TextDocument, params: TextDocumentPositionParams): Hover | null {
    if (!uriToPath(document.uri).endsWith(".gsp")) return null;
    const line = document.getText().split("\n")[params.position.line] ?? "";
    const tagName = /<\/?([\w-]+:[\w-]+)/.exec(line)?.[1];
    const spec = tagName ? GSP_TAGS[tagName] : null;
    if (!tagName || !spec) return null;
    return { contents: { kind: MarkupKind.Markdown, value: `**<${tagName}>** — ${spec.description}\n\nAttributes: ${spec.attributes.map((attribute) => `\`${attribute}\``).join(", ")}` } };
}

export function getGspSymbols(document: TextDocument): SymbolInformation[] {
    if (!uriToPath(document.uri).endsWith(".gsp")) return [];
    const filePath = uriToPath(document.uri);
    const symbols: SymbolInformation[] = [];
    document.getText().split("\n").forEach((line, index) => {
        for (const match of line.matchAll(/<(g|asset|[\w-]+):([\w-]+)/g)) {
            symbols.push(SymbolInformation.create(`${match[1]}:${match[2]}`, SymbolKind.Function, Range.create(Position.create(index, match.index ?? 0), Position.create(index, (match.index ?? 0) + match[0].length)), pathToUri(filePath)));
        }
    });
    return symbols.slice(0, 500);
}

function diagnostic(line: number, start: number, end: number, message: string): Diagnostic {
    return {
        range: Range.create(Position.create(line, start), Position.create(line, end)),
        severity: DiagnosticSeverity.Warning,
        source: "grails-gsp",
        message,
    };
}

/** Fast, project-aware diagnostics for the most common broken GSP references. */
export function getGspDiagnostics(document: TextDocument, project: GrailsProject | null): Diagnostic[] {
    if (!project || !uriToPath(document.uri).endsWith(".gsp")) return [];
    const results: Diagnostic[] = [];
    const custom = customTags(project);
    const viewsRoot = path.join(project.root, "grails-app", "views");
    let expressionDepth = 0;

    document.getText().split("\n").forEach((line, lineNumber) => {
        expressionDepth += (line.match(/\$\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
        for (const match of line.matchAll(/<([\w-]+:[\w-]+)\b([^>]*)>/g)) {
            const [whole, name, attributes] = match;
            const start = match.index ?? 0;
            const spec = GSP_TAGS[name];
            if ((name.startsWith("g:") || name.startsWith("asset:")) && !spec && !custom.has(name)) {
                results.push(diagnostic(lineNumber, start, start + whole.length, `Unknown Grails tag <${name}>.`));
                continue;
            }
            for (const required of spec?.required ?? []) {
                if (!new RegExp(`\\b${required}\\s*=`).test(attributes)) {
                    results.push(diagnostic(lineNumber, start, start + whole.length, `<${name}> requires the '${required}' attribute.`));
                }
            }

            const controller = /\bcontroller\s*=\s*['"]([\w-]+)['"]/.exec(attributes)?.[1];
            if (controller) {
                const className = `${controller.charAt(0).toUpperCase()}${controller.slice(1)}Controller`;
                if (!project.controllers.has(className)) results.push(diagnostic(lineNumber, start, start + whole.length, `Controller '${controller}' does not exist.`));
            }
        }
    });

    // Resolve literal template/layout/asset references using the same conventions as definition.
    document.getText().split("\n").forEach((line, lineNumber) => {
        const template = /\btemplate\s*=\s*['"]([^'"$]+)['"]/.exec(line)?.[1];
        if (template) {
            const logical = template.replace(/\.gsp$/, "").replace(/^\//, "").split("/");
            logical[logical.length - 1] = `_${logical[logical.length - 1].replace(/^_/, "")}.gsp`;
            if (!existing([path.join(path.dirname(uriToPath(document.uri)), ...logical), path.join(viewsRoot, ...logical)])) {
                results.push(diagnostic(lineNumber, 0, line.length, `Template '${template}' does not exist.`));
            }
        }
        const layout = /<meta\b[^>]*\bname\s*=\s*['"]layout['"][^>]*\bcontent\s*=\s*['"]([^'"$]+)['"]/.exec(line)?.[1]
            ?? /<g:applyLayout\b[^>]*\bname\s*=\s*['"]([^'"$]+)['"]/.exec(line)?.[1];
        if (layout && !fs.existsSync(path.join(viewsRoot, "layouts", `${layout}.gsp`))) {
            results.push(diagnostic(lineNumber, 0, line.length, `Layout '${layout}' does not exist.`));
        }
    });

    if (expressionDepth > 0) {
        const lastLine = Math.max(0, document.lineCount - 1);
        results.push(diagnostic(lastLine, 0, 1, "Unclosed GSP expression '${...}'."));
    }
    return results.slice(0, 200);
}
