import * as path from "path";

export function isPathWithin(root: string, candidate: string): boolean {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return (
        relative === "" ||
        (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
}

export function resolvePathWithin(
    root: string,
    relativeInput: string,
): string | null {
    const value = relativeInput.trim().replace(/\\/g, "/");
    if (!value || value.includes("\0") || path.posix.isAbsolute(value))
        return null;
    const segments = value.split("/");
    if (segments.some((segment) => segment === ".." || segment === ""))
        return null;
    const resolved = path.resolve(root, ...segments);
    return isPathWithin(root, resolved) ? resolved : null;
}

export function isSafeEntryName(value: string): boolean {
    const name = value.trim();
    return (
        name.length > 0 &&
        name !== "." &&
        name !== ".." &&
        !name.includes("\0") &&
        !name.includes("/") &&
        !name.includes("\\")
    );
}
