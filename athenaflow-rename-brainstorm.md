# AthenaFlow Rename — Brainstorm & Analysis

## What AthenaFlow Is (from athenaflow.in)

**A workflow runtime that makes AI coding agents predictable and repeatable.**

- Deterministic orchestration for non-deterministic agents
- Sits between developers and agent harnesses (Claude Code, OpenAI Codex, etc.)
- Declarative workflows, real-time observability, session persistence
- Harness-agnostic, CI-native execution
- Workflow marketplace and plugin system
- Tagline: *"AI agents are powerful. Now make them predictable."*

## Naming Criteria

| Criterion         | Requirement                                                    |
| ----------------- | -------------------------------------------------------------- |
| Domain            | No .com needed, but must have viable TLD (.dev, .io, .run, .sh) |
| Recall            | 2-3 syllables, easy to say in conversation                    |
| Collisions        | No funded startups or well-known products with same name       |
| Professional      | Enterprise-ready, not cute or trendy                           |
| Evocative         | Suggests reliability, orchestration, or determinism            |
| Spellable         | Someone hearing it can type it without guessing                |

## Collision Research — Names Ruled Out

| Name       | Why Ruled Out                                                        |
| ---------- | -------------------------------------------------------------------- |
| AgentLoom  | Active product (agentloom.com) — AI workflow SaaS                    |
| Condukt    | $10M-funded compliance startup (Lightspeed, MMC Ventures)            |
| Dirigent   | 3+ active products: dirigent.io, dirigent.ai, dirigent.software      |
| Lockstep   | Acquired by Sage Group (accounting SaaS)                             |
| FlowLock   | Active product (flowlock.dev) — UX contract guardrails               |
| Invar      | Invar Technologies ($24M revenue) + Invar Systems (warehouse)        |
| Steadyflow | Existing Linux download manager                                      |
| RunSteady  | Existing product (runsteady.com) — team coordination                 |
| Holdfast   | holdfast.dev (enterprise dev agency) + holdfast.studio               |
| Castline   | Castline Systems (electrical design software, UK)                    |
| Stagehand  | Browserbase product for web automation                               |

---

## Recommended Names (Collision-Cleared)

### 1. Steplock

**"Step" (workflow steps) + "Lock" (deterministic, locked-in)**

- Syllables: 2
- Pronunciation: unambiguous
- Domains to target: `steplock.dev`, `steplock.io`
- Why it works: Immediately communicates the core value — your workflow steps are *locked in*. Deterministic by name. Developers hear it and understand what it does. Short enough for CLI tooling (`steplock run`, `steplock init`).
- Tone: Professional, precise, no-nonsense
- Collision check: **Clean** — no software products found

---

### 2. Pipewright

**"Pipe" (pipeline/workflow) + "Wright" (craftsman/builder)**

- Syllables: 2
- Pronunciation: PIPE-right
- Domains to target: `pipewright.dev`, `pipewright.io`
- Why it works: Follows the proven naming pattern of **Playwright** (Microsoft) — developers already associate "-wright" with reliable tooling. "Pipe" is native developer vocabulary. Conveys craftsmanship and quality.
- Tone: Professional, developer-native, premium
- Collision check: **Clean** — no software products found (Pipefy exists but is a completely different name)

---

### 3. Forgerun

**"Forge" (craft, build, harden) + "Run" (runtime, execution)**

- Syllables: 2
- Pronunciation: FORGE-run
- Domains to target: `forgerun.dev`, `forgerun.io`, `forgerun.run`
- Why it works: "Forge" implies something hardened and reliable — you're *forging* deterministic runs from chaotic agents. Action-oriented, strong. Works great as a CLI name (`forgerun deploy`, `forgerun watch`).
- Tone: Strong, industrial, reliable
- Collision check: **Clean** — no software products found

---

### 4. Stepwright

**"Step" (workflow steps) + "Wright" (craftsman)**

- Syllables: 2
- Pronunciation: STEP-right
- Domains to target: `stepwright.dev`, `stepwright.io`
- Why it works: More workflow-focused than Pipewright. "Step" directly maps to declarative workflow steps. Same "-wright" pattern that signals quality tooling. Natural phrasing: *"Define your steps, Stepwright handles the rest."*
- Tone: Clean, precise, professional
- Collision check: **Clean** — no software products found

---

### 5. Runlatch

**"Run" (runtime/execution) + "Latch" (secure, lock into place)**

- Syllables: 2
- Pronunciation: RUN-latch
- Domains to target: `runlatch.dev`, `runlatch.io`
- Why it works: Evokes latching agent runs into a deterministic path — once latched, they follow the defined route. Technical feel without being jargon. Unique in the space.
- Tone: Technical, precise
- Collision check: **Clean** — no software products found
- Caveat: Slightly less intuitive than Steplock or Pipewright on first hearing

---

## Comparative Matrix

| Name       | Recall | Evocative | CLI-friendly | Professional | Domain Outlook |
| ---------- | ------ | --------- | ------------ | ------------ | -------------- |
| Steplock   | A+     | A+        | A            | A            | Strong         |
| Pipewright | A      | A         | A            | A+           | Strong         |
| Forgerun   | A      | A         | A+           | A            | Strong         |
| Stepwright | A      | A         | A            | A+           | Strong         |
| Runlatch   | B+     | A         | A            | A            | Strong         |

## My Top Pick: **Steplock**

Rationale: It's the most instantly communicative name for what AthenaFlow does — *locking workflow steps into deterministic execution*. It's two syllables, impossible to misspell, and has zero branding collisions. It works equally well in marketing copy ("Steplock your agent workflows") and on the command line (`steplock run workflow.yaml`). The name ages well — it doesn't depend on any trend or buzzword.

Runner-up: **Pipewright** — if you want a more premium/craftsman feel and want to ride the familiarity of the Playwright naming pattern.
