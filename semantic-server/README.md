# Semantic server

The release artifact may bundle `groovy-language-server-all.jar` here. It is
built from the exact upstream revision and verified against the SHA-256 digest
declared in `upstream.json`.

Run `npm run build:semantic` with JDK 17 or newer to produce the JAR. Set
`GRAILS_SEMANTIC_JAVA_HOME` when the machine's default `JAVA_HOME` is older. The
normal TypeScript build does not access the network. Release packaging must run
the semantic build first and must retain `NOTICE`, `LICENSE.md`, and the license
files embedded in the JAR.
