import {
    CompletionItem,
    CompletionItemKind,
    InsertTextFormat,
    MarkupKind,
    TextDocumentPositionParams,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { DomainClass, GrailsProject } from "./grailsProject";
import { uriToPath } from "./uriUtils";

interface DslItem {
    label: string;
    snippet?: string;
    detail: string;
}

const CONSTRAINTS: DslItem[] = [
    { label: "nullable", snippet: "nullable: ${1|true,false|}", detail: "Allow or reject null values" },
    { label: "blank", snippet: "blank: ${1|true,false|}", detail: "Allow or reject blank strings" },
    { label: "unique", snippet: "unique: ${1|true,false|}", detail: "Require a unique persistent value" },
    { label: "email", snippet: "email: ${1|true,false|}", detail: "Validate an email address" },
    { label: "url", snippet: "url: ${1|true,false|}", detail: "Validate a URL" },
    { label: "matches", snippet: "matches: /${1:pattern}/", detail: "Validate against a regular expression" },
    { label: "inList", snippet: "inList: [${1:values}]", detail: "Restrict to a list of values" },
    { label: "notEqual", snippet: "notEqual: ${1:value}", detail: "Reject a particular value" },
    { label: "min", snippet: "min: ${1:value}", detail: "Minimum comparable value" },
    { label: "max", snippet: "max: ${1:value}", detail: "Maximum comparable value" },
    { label: "range", snippet: "range: ${1:min}..${2:max}", detail: "Allowed value range" },
    { label: "size", snippet: "size: ${1:min}..${2:max}", detail: "Allowed collection or string size" },
    { label: "minSize", snippet: "minSize: ${1:size}", detail: "Minimum collection or string size" },
    { label: "maxSize", snippet: "maxSize: ${1:size}", detail: "Maximum collection or string size" },
    { label: "scale", snippet: "scale: ${1:2}", detail: "Decimal scale" },
    { label: "validator", snippet: "validator: { value, object, errors ->\n\t${1}\n}", detail: "Custom validation closure" },
];

const MAPPINGS: DslItem[] = [
    { label: "table", snippet: "table '${1:table_name}'", detail: "Map the domain to a database table" },
    { label: "id", snippet: "id generator: '${1|identity,sequence,uuid,assigned|}'", detail: "Configure identifier mapping" },
    { label: "version", snippet: "version ${1|true,false|}", detail: "Enable optimistic locking" },
    { label: "cache", snippet: "cache ${1|true,false|}", detail: "Configure second-level caching" },
    { label: "sort", snippet: "sort '${1:property}'", detail: "Default sort property" },
    { label: "order", snippet: "order '${1|asc,desc|}'", detail: "Default sort direction" },
    { label: "autoTimestamp", snippet: "autoTimestamp ${1|true,false|}", detail: "Enable dateCreated/lastUpdated timestamps" },
    { label: "dynamicInsert", snippet: "dynamicInsert ${1|true,false|}", detail: "Generate INSERT statements dynamically" },
    { label: "dynamicUpdate", snippet: "dynamicUpdate ${1|true,false|}", detail: "Generate UPDATE statements dynamically" },
    { label: "discriminator", snippet: "discriminator '${1:value}'", detail: "Configure inheritance discriminator" },
    { label: "tablePerHierarchy", snippet: "tablePerHierarchy ${1|true,false|}", detail: "Configure inheritance table strategy" },
];

const CRITERIA: DslItem[] = [
    { label: "eq", snippet: "eq '${1:property}', ${2:value}", detail: "Property equals value" },
    { label: "ne", snippet: "ne '${1:property}', ${2:value}", detail: "Property does not equal value" },
    { label: "gt", snippet: "gt '${1:property}', ${2:value}", detail: "Property greater than value" },
    { label: "ge", snippet: "ge '${1:property}', ${2:value}", detail: "Property greater than or equal to value" },
    { label: "lt", snippet: "lt '${1:property}', ${2:value}", detail: "Property less than value" },
    { label: "le", snippet: "le '${1:property}', ${2:value}", detail: "Property less than or equal to value" },
    { label: "between", snippet: "between '${1:property}', ${2:from}, ${3:to}", detail: "Property between two values" },
    { label: "like", snippet: "like '${1:property}', '${2:pattern}'", detail: "SQL LIKE restriction" },
    { label: "ilike", snippet: "ilike '${1:property}', '${2:pattern}'", detail: "Case-insensitive LIKE restriction" },
    { label: "inList", snippet: "inList '${1:property}', ${2:values}", detail: "Property contained in a collection" },
    { label: "isNull", snippet: "isNull '${1:property}'", detail: "Property is null" },
    { label: "isNotNull", snippet: "isNotNull '${1:property}'", detail: "Property is not null" },
    { label: "isEmpty", snippet: "isEmpty '${1:property}'", detail: "Collection is empty" },
    { label: "isNotEmpty", snippet: "isNotEmpty '${1:property}'", detail: "Collection is not empty" },
    { label: "and", snippet: "and {\n\t${1}\n}", detail: "Boolean AND group" },
    { label: "or", snippet: "or {\n\t${1}\n}", detail: "Boolean OR group" },
    { label: "not", snippet: "not {\n\t${1}\n}", detail: "Boolean NOT group" },
    { label: "projections", snippet: "projections {\n\t${1}\n}", detail: "Projection block" },
    { label: "property", snippet: "property '${1:property}'", detail: "Project a property" },
    { label: "distinct", snippet: "distinct '${1:property}'", detail: "Project distinct property values" },
    { label: "count", snippet: "count()", detail: "Count results" },
    { label: "countDistinct", snippet: "countDistinct '${1:property}'", detail: "Count distinct values" },
    { label: "rowCount", snippet: "rowCount()", detail: "Project result row count" },
    { label: "order", snippet: "order '${1:property}', '${2|asc,desc|}'", detail: "Sort criteria results" },
    { label: "maxResults", snippet: "maxResults ${1:10}", detail: "Limit result count" },
    { label: "firstResult", snippet: "firstResult ${1:0}", detail: "Set pagination offset" },
    { label: "fetchMode", snippet: "fetchMode '${1:association}', ${2:FetchMode.JOIN}", detail: "Configure association fetching" },
    { label: "join", snippet: "join '${1:association}'", detail: "Join an association" },
];

function item(spec: DslItem): CompletionItem {
    return {
        label: spec.label,
        kind: CompletionItemKind.Method,
        detail: spec.detail,
        documentation: { kind: MarkupKind.Markdown, value: spec.detail },
        insertText: spec.snippet ?? spec.label,
        insertTextFormat: spec.snippet ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
    };
}

function bracesAreOpen(text: string, marker: RegExp): boolean {
    const matches = [...text.matchAll(marker)];
    const last = matches[matches.length - 1];
    if (!last || last.index == null) return false;
    const tail = text.slice(last.index);
    let depth = 0;
    for (const char of tail) {
        if (char === "{") depth++;
        else if (char === "}") depth--;
    }
    return depth > 0;
}

function domainForDocument(document: TextDocument, project: GrailsProject): DomainClass | null {
    const file = uriToPath(document.uri);
    for (const domain of project.domains.values()) {
        if (domain.filePath === file) return domain;
    }
    const before = document.getText();
    const matches = [...before.matchAll(/\b([A-Z]\w*)\.(?:withCriteria|where|whereAny|createCriteria)\b/g)];
    return project.domains.get(matches[matches.length - 1]?.[1] ?? "") ?? null;
}

function propertyItems(domain: DomainClass | null, quoted = false): CompletionItem[] {
    if (!domain) return [];
    return domain.properties.map((property) => ({
        label: property.name,
        kind: CompletionItemKind.Property,
        detail: `${property.type} property of ${domain.name}`,
        insertText: quoted ? `'${property.name}'` : property.name,
    }));
}

function mappingPropertyItems(domain: DomainClass | null): CompletionItem[] {
    if (!domain) return [];
    return domain.properties.map((property) => ({
        label: property.name,
        kind: CompletionItemKind.Property,
        detail: `Map ${property.type} ${property.name}`,
        insertText: `${property.name} \${1:column}: '\${2:${property.name}}'`,
        insertTextFormat: InsertTextFormat.Snippet,
    }));
}

/** Context-aware completion for the Grails/GORM closure DSLs. */
export function getGormDslCompletions(
    document: TextDocument,
    params: TextDocumentPositionParams,
    project: GrailsProject,
): CompletionItem[] | null {
    if (!uriToPath(document.uri).endsWith(".groovy")) return null;
    const before = document.getText().slice(0, document.offsetAt(params.position));
    const domain = domainForDocument(document, project);

    if (bracesAreOpen(before, /static\s+constraints\s*=\s*\{/g)) {
        const currentLine = before.slice(before.lastIndexOf("\n") + 1);
        const propertyConstraint = /^\s*[A-Za-z_]\w*\s+[^\n]*$/.test(currentLine);
        if (propertyConstraint) return CONSTRAINTS.map(item);
        return propertyItems(domain).map((property) => ({
            ...property,
            insertText: `${property.label} \${1:nullable}: \${2:false}`,
            insertTextFormat: InsertTextFormat.Snippet,
            detail: `Declare constraints for ${property.detail}`,
        }));
    }

    if (bracesAreOpen(before, /static\s+mapping\s*=\s*\{/g)) {
        return [...MAPPINGS.map(item), ...mappingPropertyItems(domain)];
    }

    if (
        bracesAreOpen(before, /\.(?:withCriteria|where|whereAny)\s*\{/g) ||
        bracesAreOpen(before, /\.(?:list|get|count|scroll)\s*\{/g)
    ) {
        return [...CRITERIA.map(item), ...propertyItems(domain, true)];
    }

    return null;
}
