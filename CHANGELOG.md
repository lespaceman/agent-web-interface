## [2.0.1] - 2026-01-12

- fix(ci): ignore CHANGELOG.md from prettier checks
- fix(ci): trigger release workflow via workflow_dispatch

# Changelog

## [2.0.0] - 2026-01-12

- fix(ci): add --ignore-scripts to version bump workflow
- Merge pull request #10 from lespaceman/feat/factpack-and-page-brief
- fix: address PR review comments for simplified browser tools API
- feat: add simplified browser tools API with 11 tools
- style: update table formatting for consistency in README
- Merge pull request #9 from lespaceman/feat/factpack-and-page-brief
- docs: rewrite README for simplified 8-tool design
- Merge pull request #3 from lespaceman/feat/factpack-and-page-brief
- fix(ci): track .prettierignore so CI can use it
- feat: expose backend_node_id in find_elements and get_node_details
- fix: derive node_id from backend_node_id for stability across snapshots
- style: apply prettier formatting
- chore: improve tool docs, fix tests, and add manual test plan
- feat: make factpack optional in tool responses, return page_brief by default
- fix(factpack): detect forms by region fallback when AX role missing
- chore: add code formatting
- fix(deps): update dependencies to resolve high severity vulnerabilities
- feat(factpack): implement Phase 2 FactPack extraction and Phase 3 XML renderer
- feat(snapshot): implement Phase 1 - node filtering, semantic group_id, footer detection, find_elements tool
- fix(snapshot): isolate heading context at iframe boundaries and optimize traversal
- fix(locator): handle empty AX names, Playwright escaping, and aria-label normalization
- fix(locator): use raw accessible names and proper CSS control char escaping
- fix(snapshot): fall back to DOM-derived label when AX heading name missing
- fix(snapshot): CSS escaping, frame/shadow paths, and DOM ordering
- docs: document CDP-based click implementation in engineering plan
- fix(action): use CDP backendNodeId for clicking to avoid Playwright strict mode violations
- feat(snapshot): extract attribute extractor as modular component
- feat(query): implement simple query engine for snapshot data
- feat(snapshot): implement modular snapshot compiler with extractors
- feat: implement minimal E2E MCP browser tools
- feat(phase-a): add storageState and persistent profile support
- feat: add PageRegistry methods and test infrastructure
- fix: address architecture review issues for browser session layer
- feat(phase-a): implement browser session foundations with TDD
- feat: add foundation for Playwright + CDP browser tool
- feat: add repository and tooling guidelines documentation feat: introduce engineering plan for Athena Browser MCP feat: revamp MCP tooling implementation plan fix: enhance content extraction with fallback to innerText refactor: improve element resolution with fuzzy matching filters feat: extend form detection to support ARIA roles and custom controls refactor: optimize selector building with improved parent and nth-child resolution

