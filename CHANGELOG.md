## [2.1.1] - 2026-01-16

- Merge pull request #20 from lespaceman/fix/eid-scroll-stability
- fix: stabilize element IDs across scrolling
- Merge pull request #19 from lespaceman/feat/descriptive-state-attributes
- refactor: use boolean text values instead of 0/1
- feat: use descriptive attribute names in XML snapshots

## [2.1.0] - 2026-01-15

- Merge pull request #16 from lespaceman/claude/rewrite-readme-VfUuq
- style: fix README formatting
- docs: rewrite README with cleaner structure and tone

## [2.0.5] - 2026-01-15

- docs: replace Design Philosophy with Why Athena section
- Merge pull request #15 from lespaceman/fix/network-idle-stabilization
- feat: add mutations tracking for status-bearing elements
- fix: improve formatting and readability in session manager and test files
- refactor(test): consolidate local mock factories to use centralized mocks
- refactor(test): centralize mock page with event emission support
- fix: implement PageNetworkTracker for reliable network idle detection
- refactor: extract network idle waiting to shared utility
- fix: add network idle waiting after actions and navigation
- Merge pull request #14 from lespaceman/fix/shadow-dom-observation-duplicates
- refactor: remove browser-side dedup in favor of server-side approach
- fix: deduplicate observations with same tag and text content
- test: add new universal signals to state-renderer test fixtures
- fix: prevent duplicate observations from shadow DOM existing content
- Merge pull request #13 from lespaceman/feat/dom-observations
- fix: skip integration tests in CI environment
- chore: update MCP SDK and improve observation code
- fix: add observer staleness detection for body replacement
- feat: add DOM observations with EID linking

## [2.0.4] - 2026-01-15

- Merge pull request #12 from lespaceman/fix/tool-descriptions
- fix: drop Node 18 support, require Node 20+
- fix: require Node.js 18.19+ for node:inspector/promises
- fix: require Node.js 18.18+ for vitest v4 compatibility
- chore: fix npm audit vulnerabilities
- docs: add Claude Code CLI config
- docs: add MCP client configurations for VS Code, Cursor, Codex, Gemini
- docs: add missing find_elements params to README
- fix: standardize tool descriptions for LLM clarity

## [2.0.3] - 2026-01-13

- Merge pull request #11 from lespaceman/feat/delta-factpack
- docs: add cookie consent test scenarios to manual test plan
- feat: add include_readable param and proactive staleness detection
- feat: include shadow path in EID computation for shadow DOM
- feat: add multi-frame AX extraction for iframe support
- test: add comprehensive tests for state modules and refactor execute-action
- chore: remove outdated planning and debug docs
- docs: extend manual test plan with Suite 11 advanced scenarios
- refactor: unify on eid across all discovery and action tools
- fix: EID lookup mismatch between XML response and registry
- refactor!: remove deprecated node_id API and consolidate code patterns
- chore: add .gemini to gitignore
- test: suppress log pollution during test runs
- chore: remove deprecated design docs and unused code
- fix: false navigation detection and diff-only rendering
- feat: add ElementRegistry, CDP recovery, and XML response format
- feat: implement StateHandle + Diff + Actionables system
- docs: add delta removal and page_summary optimization design docs
- refactor: remove delta system and simplify to page_summary responses
- refactor: optimize page_summary schema to reduce token count by 51%
- fix: default connect_browser endpoint
- chore: remove legacy tool contracts
- feat: add structured delta payloads and v2 tools
- fix: address PR review - remove redundant casts and add unit tests
- fix: address delta FactPack review issues
- fix: handle overlay replacements to avoid stale refs
- feat: implement delta FactPack for mutation tools

## [2.0.2] - 2026-01-12

- fix(ci): add explicit tag_name for gh-release action

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

