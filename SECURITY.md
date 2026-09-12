# Security

## Workspace execution

Grails and Gradle wrappers are project-controlled programs. The extension must
not execute them in Restricted Mode. Commands are resolved from an internal
allowlist and run only after `vscode.workspace.isTrusted` is true.

## File operations

All paths derived from prompts must be resolved below the selected project or
tree folder. Absolute paths, `..`, null bytes and rename values containing path
separators are rejected.

## Reporting

Please report suspected vulnerabilities privately to the repository owner rather
than opening a public issue containing exploit details, credentials or sensitive
project source.
