# Agent Web Interface

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

Agent Web Interface exists to change the unit of information exposed to the model.

---

## Core Idea: Semantic Page Snapshots

Instead of exposing raw DOM structures or full accessibility trees, Agent Web Interface produces **semantic page snapshots**.

These snapshots are:

- Compact and structured
- Focused on user-visible intent
- Designed for LLM recall and reasoning, not DOM completeness
- Stable across layout shifts and DOM churn

The goal is not to mirror the browser, but to present the page in a form that aligns with how language models reason about interfaces.

---

## How It Works

At a high level:

1. The browser is controlled via Puppeteer and CDP
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

## What Agent Web Interface Is (and Is Not)

### Agent Web Interface is:

- A semantic interface between browsers and LLM agents
- An MCP server focused on reliability and efficiency
- Designed for agent workflows, not test automation

### Agent Web Interface is not:

- A general-purpose browser
- A visual testing or screenshot framework
- A replacement for Puppeteer

Puppeteer remains the execution layer; Agent Web Interface focuses on representation and reasoning.

---

## Usage

Agent Web Interface implements the **Model Context Protocol (MCP)** and works with:

- Claude Code
- Claude Desktop
- Cursor
- VS Code
- Any MCP-compatible client

Example workflows include:

- Navigating complex web apps
- Handling login and consent flows
- Performing multi-step UI interactions with lower token usage

---

## Claude Code

```bash
# Default: connects to your running Chrome, falls back to launching a new browser
claude mcp add agent-web-interface -- npx agent-web-interface@latest

# Explicit mode: always connect to your Chrome (no fallback)
claude mcp add agent-web-interface -e AWI_BROWSER_MODE=user -- npx agent-web-interface@latest

# Explicit mode: always launch a persistent browser
claude mcp add agent-web-interface -e AWI_BROWSER_MODE=persistent -- npx agent-web-interface@latest
```

---

## CLI Arguments

The server accepts transport-level arguments only. Browser configuration is per-session via the `navigate` tool.

| Argument      | Description                       | Default |
| ------------- | --------------------------------- | ------- |
| `--transport` | Transport mode: `stdio` or `http` | `stdio` |
| `--port`      | Port for HTTP transport           | `3000`  |

### Browser Session Modes

Browser initialization is automatic on the first tool call. Set `AWI_BROWSER_MODE` to control how the browser is started:

| Mode         | Behavior                                             | Profile                                       |
| ------------ | ---------------------------------------------------- | --------------------------------------------- |
| _(unset)_    | Auto: try `user` → `persistent` → `isolated`         | Depends on fallback                           |
| `user`       | Connect to your running Chrome                       | Chrome's default profile                      |
| `persistent` | Launch Chrome with a dedicated persistent profile    | `~/.cache/agent-web-interface/chrome-profile` |
| `isolated`   | Launch Chrome with a temporary profile (clean slate) | None (deleted on close)                       |

Examples:

```bash
# Auto mode (default) — connects to Chrome if running, else launches
npx agent-web-interface

# Always connect to your Chrome (fails if Chrome isn't running)
AWI_BROWSER_MODE=user npx agent-web-interface

# Always launch with persistent profile
AWI_BROWSER_MODE=persistent npx agent-web-interface

# Headless isolated browser
AWI_BROWSER_MODE=isolated AWI_HEADLESS=true npx agent-web-interface

# HTTP transport mode
npx agent-web-interface --transport http --port 8080
```

---

## Using Your Existing Chrome (Chrome 144+)

To connect with your bookmarks, extensions, and logged-in sessions:

1. Navigate to `chrome://inspect/#remote-debugging` in Chrome
2. Enable remote debugging and allow the connection
3. Set `AWI_BROWSER_MODE=user` (or leave unset for auto mode)

```json
{
  "mcpServers": {
    "agent-web-interface": {
      "command": "npx",
      "args": ["agent-web-interface@latest"],
      "env": {
        "AWI_BROWSER_MODE": "user"
      }
    }
  }
}
```

---

## Environment Variables

| Variable           | Description                                              | Default                  |
| ------------------ | -------------------------------------------------------- | ------------------------ |
| `AWI_BROWSER_MODE` | Browser mode: `user`, `persistent`, or `isolated`        | _(unset: auto fallback)_ |
| `AWI_HEADLESS`     | Run browser headless (`true`/`false`)                    | `false`                  |
| `AWI_CDP_URL`      | Explicit CDP endpoint (overrides mode)                   | -                        |
| `AWI_TRIM_REGIONS` | Set to `false` to disable region trimming globally       | `true`                   |
| `TRANSPORT`        | Transport mode override (`http`)                         | -                        |
| `HTTP_HOST`        | Host for HTTP transport                                  | `127.0.0.1`              |
| `HTTP_PORT`        | Port for HTTP transport                                  | `3000`                   |
| `LOG_LEVEL`        | Logging level                                            | `info`                   |
| `CEF_BRIDGE_HOST`  | CDP host for CEF bridge connection                       | `127.0.0.1`              |
| `CEF_BRIDGE_PORT`  | CDP port for CEF bridge connection                       | `9223`                   |
| `BRING_TO_FRONT`   | Set to `true` to focus the Chrome tab before each action | `false`                  |
| `CHROME_PATH`      | Path to Chrome executable (multi-tenant)                 | -                        |

---

## Installation

```bash
git clone https://github.com/lespaceman/agent-web-interface
cd agent-web-interface
npm install
npm run build
```

Configure the MCP server in your client according to its MCP integration instructions.

---

## Architecture Overview

Agent Web Interface separates concerns into three layers:

- **Browser lifecycle** — page creation, navigation, teardown
- **Semantic snapshot generation** — regions, elements, identifiers
- **Action resolution** — mapping agent intent to browser actions

This separation allows each layer to evolve independently while keeping agent-visible behavior stable.

---

## Status

Agent Web Interface is under active development.
APIs and snapshot formats may evolve as real-world agent usage informs the design.

Feedback from practitioners building agent systems is especially welcome.

---

## License

MIT
