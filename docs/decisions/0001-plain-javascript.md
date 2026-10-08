> [bgdb](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0001 - Plain JavaScript, no dependencies, no build step

**Status:** accepted

**Context.** The same validator must run in the browser (drop-a-file page), in a Web Worker, in the CLI and in CI
(spec EAS-04). The existing board/XGID code is plain JavaScript. The project is static-first.

**Decision.** ES modules in plain JavaScript with JSDoc comments, no runtime dependencies, no transpilation. Node.js
>= 22 (pinned to v24.21.0 in `.node-version`), tests with the built-in `node:test` runner. SHA-256 is implemented
in pure JS so that hashing is synchronous in every runtime.

**Consequences.** Nothing to install or audit; files can be served as they are. No static type checking (JSDoc
types can be checked later with `tsc --checkJs` without changing the code). CommonJS code (`module.exports`) in
older files must be converted to ES modules when reused.
