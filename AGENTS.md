# Repository Guidelines

## Project Structure & Module Organization
TypeScript sources live in `src/`, with feature-specific domains under `src/domains/`, bridge adapters in `src/bridge/`, and shared utilities under `src/shared/`. Runtime configuration helpers sit in `src/config/`, while the HTTP/MCP entrypoint is `src/index.ts`. Tests mirror this layout in `tests/unit/` and `tests/integration/`, and `dist/` holds the compiled server that ships to npm. Keep assets such as fixtures or HAR samples under `tests/fixtures/` to avoid polluting the runtime bundle.

## Build, Test, and Development Commands
Use `npm run dev` for incremental TypeScript compilation while iterating on tools, and `npm run build` for the production-ready output in `dist/`. `npm start` executes the compiled MCP server for smoke testing. Quality gates are bundled into `npm run check`, which chains the type checker, ESLint, Prettier verification, and the full Vitest suite. To inspect MCP tooling locally, run `npm run mcp:inspect` once you have a built artifact.

## Coding Style & Naming Conventions
Follow TypeScript strictness enforced by `tsc --noEmit` and the project’s ESLint configuration, which prefers explicit async error handling (`@typescript-eslint/no-floating-promises`). Prettier keeps formatting consistent (2-space indent, trailing commas, single quotes), so run `npm run format` before pushing. Exported tool handlers should use descriptive verb-noun names (`navigateTo`, `captureSnapshot`), and files should follow kebab-case to match existing modules.

## Testing Guidelines
Vitest is the single test runner. Unit suites belong in `tests/unit/<feature>.test.ts`, while cross-tool flows go into `tests/integration/`. Aim for meaningful coverage of safety-critical domains (navigation, session, audit logging) and run `npm run test:coverage` before tagging a release. Use deterministic fixtures and prefer the `nav_wait` helpers over arbitrary `setTimeout` calls to keep tests reliable.

## Commit & Pull Request Guidelines
Commits generally follow Conventional Commits (`fix:`, `chore:`, version tags), enabling automated releases. Keep messages focused on one change set and include context on affected tools or bridges. Pull requests should describe the motivation, summarize testing (`npm run check` output), link related issues, and attach screenshots or HAR snippets when UI-visible behavior changes. Draft PRs are welcome while you iterate, but remove WIP markers before requesting review.

## Security & Configuration Tips
The server talks to the CEF bridge via `CEF_BRIDGE_HOST`/`CEF_BRIDGE_PORT`; avoid hardcoding credentials and document any new environment knobs in `README.md`. Use `ALLOWED_FILE_DIRS` to constrain upload surfaces during testing, and never commit real session data or cookies—store them under ignored paths like `tests/fixtures/tmp/` if absolutely necessary.
