# Athena Browser MCP

An MCP server for browser automation that exposes semantic, token-efficient page representations optimized for LLM agents.

---

## Motivation

LLM-based agents operate under strict context window and token constraints.
However, most browser automation tools expose entire DOMs or full accessibility trees to the model.

This leads to:

- Rapid token exhaustion
- Higher inference costs
- Reduced reliability as relevant signal is buried in noise

In practice, agents spend more effort _finding_ the right information than reasoning about it.

Athena exists to change the unit of information exposed to the model.

---

## Core Idea: Semantic Page Snapshots

Instead of exposing raw DOM structures or full accessibility trees, Athena produces **semantic page snapshots**.

These snapshots are:

- Compact and structured
- Focused on user-visible intent
- Designed for LLM recall and reasoning, not DOM completeness
- Stable across layout shifts and DOM churn

The goal is not to mirror the browser, but to present the page in a form that aligns with how language models reason about interfaces.

---

## How It Works

At a high level:

1. The browser is controlled via Playwright and CDP
2. The page is reduced into semantic regions and actionable elements
3. A structured snapshot is generated and sent to the LLM
4. Actions are resolved against stable semantic identifiers rather than fragile selectors

This separation keeps:

- Browser lifecycle management isolated
- Snapshots deterministic and low-entropy
- Agent reasoning predictable and efficient

---

## Benchmarks

Early benchmarks against Playwright MCP show:

- **~19% fewer tokens consumed**
- **~33% faster task completion**
- Same or better success rates on common navigation tasks

Benchmarks were run using Claude Code on representative real-world tasks.
Results are task-dependent and should be treated as directional rather than absolute.

---

## What Athena Is (and Is Not)

### Athena is:

- A semantic interface between browsers and LLM agents
- An MCP server focused on reliability and efficiency
- Designed for agent workflows, not test automation

### Athena is not:

- A general-purpose browser
- A visual testing or screenshot framework
- A replacement for Playwright

Playwright remains the execution layer; Athena focuses on representation and reasoning.

---

## Usage

Athena implements the **Model Context Protocol (MCP)** and works with:

- Claude Code
- Claude Desktop
- Cursor
- VS Code
- Any MCP-compatible client

Example workflows include:

- Navigating complex web apps
- Handling login and consent flows
- Performing multi-step UI interactions with lower token usage

See the `examples/` directory for concrete agent workflows.

---

## Installation

```bash
git clone https://github.com/lespaceman/athena-browser-mcp
cd athena-browser-mcp
npm install
npm run build
```

Configure the MCP server in your client according to its MCP integration instructions.

---

## Architecture Overview

Athena separates concerns into three layers:

- **Browser lifecycle** — page creation, navigation, teardown
- **Semantic snapshot generation** — regions, elements, identifiers
- **Action resolution** — mapping agent intent to browser actions

This separation allows each layer to evolve independently while keeping agent-visible behavior stable.

---

## Status

Athena is under active development.
APIs and snapshot formats may evolve as real-world agent usage informs the design.

Feedback from practitioners building agent systems is especially welcome.

---

## License

MIT
