interface CompletionLike {
    label: string | { label: string };
    detail?: string;
    insertText?: string | { value: string };
}

interface PositionLike {
    line: number;
    character: number;
}

interface RangeLike {
    start: PositionLike;
    end: PositionLike;
}

interface LocationLike {
    uri?: { toString(): string } | string;
    range?: RangeLike;
    targetUri?: { toString(): string } | string;
    targetRange?: RangeLike;
    targetSelectionRange?: RangeLike;
}

export function mergeByKey<T>(
    primary: readonly T[] | null | undefined,
    secondary: readonly T[] | null | undefined,
    key: (value: T) => string,
): T[] {
    const merged = new Map<string, T>();
    for (const value of primary ?? []) merged.set(key(value), value);
    for (const value of secondary ?? []) {
        const valueKey = key(value);
        if (!merged.has(valueKey)) merged.set(valueKey, value);
    }
    return [...merged.values()];
}

export function completionKey(item: CompletionLike): string {
    return (typeof item.label === "string" ? item.label : item.label.label)
        .trim()
        .toLocaleLowerCase();
}

export function mergeCompletionItems<T extends CompletionLike>(
    primary: readonly T[] | null | undefined,
    secondary: readonly T[] | null | undefined,
): T[] {
    const primaryLabels = new Set((primary ?? []).map(completionKey));
    const signature = (item: T) => {
        const insertText = typeof item.insertText === "string"
            ? item.insertText
            : item.insertText?.value ?? "";
        return `${completionKey(item)}:${item.detail ?? ""}:${insertText}`;
    };
    const merged = mergeByKey(primary, [], signature);
    const known = new Set(merged.map(signature));
    for (const item of secondary ?? []) {
        if (primaryLabels.has(completionKey(item))) continue;
        const itemSignature = signature(item);
        if (known.has(itemSignature)) continue;
        known.add(itemSignature);
        merged.push(item);
    }
    return merged;
}

function rangeKey(range: RangeLike | undefined): string {
    if (!range) return "";
    return `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
}

export function locationKey(location: LocationLike): string {
    if (location.targetUri) {
        return `link:${location.targetUri.toString()}:${rangeKey(location.targetRange)}:${rangeKey(location.targetSelectionRange)}`;
    }
    return `location:${location.uri?.toString() ?? ""}:${rangeKey(location.range)}`;
}

export function symbolKey(symbol: { name: string; kind: number; range?: RangeLike; location?: LocationLike }): string {
    return `${symbol.name}:${symbol.kind}:${rangeKey(symbol.range ?? symbol.location?.range)}`;
}
