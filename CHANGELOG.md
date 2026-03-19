## [4.4.0] - 2026-03-19

- fix: resolve CI failures from formatting and dependency vulnerabilities
- refactor: address code review findings
- refactor: remove backward-compatibility re-exports, use direct imports
- refactor: extract form-detector and field-extractor into focused modules (Phases 6-7)
- refactor: extract query-engine and layer-detector into focused modules (Phase 8)
- refactor: extract session-manager utilities and types (Phase 5)
- refactor: split browser-tools into category modules (Phase 4)
- refactor: extract execute-action into focused modules (Phase 3)
- refactor: extract state-manager utilities into focused modules (Phase 2)
- refactor: extract snapshot-compiler into focused modules (Phase 1)
- feat: add toast overlay layer detection and unsemantic toast library support (Phases 5-6)
- feat: add characterData and visibility tracking to DOM observer (Phase 4)
- feat: add live region support for ephemeral UI feedback (alerts, toasts, status)

## [4.3.0] - 2026-03-02

- refactor: replace button controls with direct shape interactions in canvas fixtures
- chore: format code and add mcp config and plan doc
- feat: add canvas inspection tool and refactor shared tool helpers
- test: add interactive canvas fixtures for all 7 supported libraries
- chore: remove unused plan and docs files

## [4.2.0] - 2026-03-02

- fix: surface <option> elements in semantic snapshots for native <select> dropdowns
- revert: remove session_id from tool schemas
- refactor: simplify code from review findings
- chore: formatting fixes and audit cleanup
- feat: SessionWorkerBinding — route session lifecycle to context or process isolation
- feat: per-session BrowserContext isolation for cookie/storage separation
- feat: add session_id to tool schemas and session-scoped page routing
- feat: add WorkerManager for process-level Chrome isolation per session
- feat: wire SessionStore into MCP lifecycle (oninitialized/onclose)
- feat: add detach() to SessionManager — browser survives MCP server exit
- feat: port LeaseManager, HealthMonitor, PortAllocator from stale multi-tenant branch
- feat: extend SessionStore with clientInfo and getDefaultSession
- feat: add MCP lifecycle hooks (oninitialized, onclose) to BrowserAutomationServer
- chore: update patch-level dependencies
- chore: add .worktrees/ to .gitignore

## [4.1.1] - 2026-03-01

- Merge pull request #52 from lespaceman/fix/portal-overlay-snapshot
- fix: portal-rendered overlay content missing from snapshots

## [4.0.1] - 2026-02-02

- Merge pull request #50 from lespaceman/fix/take-screenshot-review-issues
- style: fix prettier formatting in test files
- Merge pull request #49 from lespaceman/feat/cross-baseline-region-dedup
- fix: address review issues in cross-baseline region dedup
- fix: address critical issues from take_screenshot PR review
- feat: add cross-baseline region deduplication
- Merge pull request #48 from lespaceman/feature/take-screenshot
- style: fix prettier formatting in test files
- feat: add take_screenshot MCP tool

## [4.0.0] - 2026-02-01

- Merge pull request #47 from lespaceman/rename/agent-web-interface
- chore!: rename athena-browser-mcp to agent-web-interface (v3.0.0)

## [2.2.4] - 2026-02-01

- Merge pull request #46 from lespaceman/feat/region-trimming
- fix: address final PR review findings and fix formatting
- feat: add generate-apple-doc plugin and clean up dead scripts
- fix: add targetFilter to puppeteer.connect() to prevent autoConnect hang
- style: fix prettier formatting in state-renderer tests
- fix: address PR review findings for region trimming and XML optimization
- docs: add cross-baseline region deduplication design
- refactor: optimize XML output format for form and element detail tools (#34)
- chore: clean up scattered docs from repo root
- feat: add region trimming for navigate and capture_snapshot responses

## [2.2.3] - 2026-01-29

- Merge pull request #45 from lespaceman/fix/browser-sync-viewport-overlay-layers
- fix: sync browser tabs, viewport detection, and overlay layer rendering
- Merge pull request #43 from lespaceman/refactor/improve-tool-descriptions
- fix: fix flaky integration tests in CI
- chore: retrigger CI
- fix: correct label matching description and fix formatting
- refactor: improve tool names and descriptions for LLM accuracy
- Merge pull request #44 from lespaceman/fix/pr37-test-coverage-improvements
- style: fix prettier formatting
- test: add missing test coverage for PR #37 CDP error classification
- Merge pull request #35 from lespaceman/fix/xml-quote-readability
- Merge pull request #42 from lespaceman/refactor/rename-list-tabs-to-list-pages
- Merge pull request #40 from lespaceman/fix/cdp-session-expected-failures
- refactor: rename list_tabs to list_pages for API consistency
- fix(cdp): check expected failures before marking session inactive
- Merge pull request #37 from lespaceman/fix/cdp-error-classification
- Merge pull request #38 from lespaceman/feat/list-tabs-tool
- feat: add list_tabs tool for tab discovery
- fix: distinguish fatal vs non-fatal CDP Protocol errors
- fix: use single quotes for XML attributes containing double quotes

## [2.2.2] - 2026-01-28

- Merge pull request #36 from lespaceman/feat/auto-connect-param
- docs: add Claude Code setup instructions to README
- test: skip autoConnect unit test that requires Chrome running
- test: skip autoConnect integration test in CI
- fix: properly mock fs module for autoConnect test
- fix: CI integration test failures
- fix: address PR review feedback for lazy browser initialization
- feat: change default headless mode from true to false
- style: fix formatting in README.md
- docs: document CLI arguments and automatic browser initialization
- test: add integration tests for lazy browser initialization
- feat: remove manual browser tools, add lazy initialization
- refactor: update tool exports for lazy init
- refactor: remove launch/connect browser schemas
- refactor: remove manual launchBrowser and connectBrowser functions
- feat: add server config module for lazy init
- feat: add ensureBrowserReady for lazy initialization
- feat: add CLI argument parsing for browser configuration
- fix: address PR review feedback for Puppeteer migration
- feat: migrate from Playwright to Puppeteer
- feat: add auto_connect parameter to connect_browser tool

## [2.2.1] - 2026-01-26

- Merge pull request #26 from lespaceman/feat/worker-manager
- fix: improve code quality from review feedback
- feat: add Chrome 144+ autoConnect support via DevToolsActivePort
- feat: optimize observation XML representation for token efficiency (#24)

## [2.2.0] - 2026-01-17

- Merge pull request #23 from lespaceman/fix/form-understanding-code-review
- style: fix prettier formatting in form module files
- feat: add runtime-based input value capture for get_form_understanding
- docs: update CLAUDE.md with current project info
- feat: register form understanding tools
- docs: clean up outdated documentation
- fix: clear dependency tracker on navigation tools
- fix: address code review issues for form understanding feature
- Merge pull request #22 from lespaceman/feat/reduce-action-response-verbosity
- ci: improve integration test workflow
- Merge pull request #21 from lespaceman/feat/reduce-action-response-verbosity
- ci: add separate workflow for integration tests with Playwright
- style: apply prettier formatting
- fix: add generic type to mock filterBySignificance to fix unsafe-return lint error
- refactor: extract ATTACHMENT_SIGNIFICANCE_THRESHOLD constant
- feat: reduce verbosity in action responses
- fix: exclude CSS/JS content from DOM mutation text extraction

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

