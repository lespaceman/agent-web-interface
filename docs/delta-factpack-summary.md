# Delta FactPack Design Summary

> High-level overview of intelligent, incremental page state delivery for Athena Browser MCP

## Problem Statement

When an agent interacts with a web page, it needs to understand what changed after each action. Sending the full page state every time is:

- **Token-expensive**: Full snapshots can be thousands of tokens
- **Noisy**: Hard for agents to identify what actually changed
- **Slow**: More tokens = longer response times

## Solution: Delta-Based State Delivery

Instead of full snapshots, send only what changed (deltas) when appropriate. The system automatically decides between:

- **Full snapshot**: First load, navigation, or too many changes
- **Delta**: Incremental additions, removals, and modifications
- **No change**: Action completed with no visible impact

## Core Design Principles

### 1. Fool-Proof Element References

Element IDs must be globally unique and validated. A reference includes:

- **backend_node_id**: CDP's unique identifier within a frame
- **frame_id**: Which frame contains the element
- **loader_id**: Document version (changes on navigation)

This prevents agents from accidentally targeting elements in the wrong frame or from a previous page load.

### 2. Explicit Invalidation

When elements are removed or a frame navigates, the agent is explicitly told which references are no longer valid. This prevents silent failures where an agent tries to click a non-existent element.

### 3. Bounded Operations

All async operations have hard timeouts. DOM stabilization (waiting for animations/mutations to settle) will never hang indefinitely, even on pages with constant activity like ads or analytics.

### 4. Baseline Integrity

Deltas are computed against a known baseline. The baseline only advances after a delta is successfully computed and delivered. This ensures consistent diff computation.

## Key Components

### Frame Tracker

Monitors frame lifecycle events (navigation, detach) and maintains:

- Current state of all frames (frameId, loaderId, URL)
- Registry of issued element references
- Pending invalidations from frame changes

When a frame navigates, all references in that frame are automatically invalidated.

### Snapshot Version Manager

Handles versioning with:

- **Monotonic version numbers**: Never decrease, even across navigations
- **Content hashing**: Detect actual changes vs. no-ops
- **Version history**: Keep last N versions for delta computation against stale agent state
- **Peek vs. capture**: Check if state changed without incrementing version

### Page Snapshot State

State machine managing page context:

- **Uninitialized**: No baseline yet
- **Base**: Normal page state
- **Overlay**: Modal/dialog is open (baseline frozen)

In overlay mode, the base page baseline is preserved so closing the overlay can correctly diff against pre-overlay state.

## Response Types

| Type             | When Used                                | Content                              |
| ---------------- | ---------------------------------------- | ------------------------------------ |
| `full`           | First load, navigation, unreliable delta | Complete page snapshot               |
| `delta`          | Incremental changes                      | Added, removed, modified elements    |
| `no_change`      | Action had no visible effect             | Confirmation message                 |
| `overlay_opened` | Modal/dialog appeared                    | Overlay content only                 |
| `overlay_closed` | Modal/dialog dismissed                   | Invalidated refs + base page changes |

## Overlay Handling

Overlays (modals, dialogs, dropdowns) receive special treatment:

1. **Detection**: ARIA roles, data attributes, and class patterns with z-index
2. **Isolation**: Overlay gets its own context; base page baseline is frozen
3. **Stacking**: Supports nested overlays (modal opens another modal)
4. **Cleanup**: Closing overlay invalidates all overlay refs and reports base page changes

## Pre-Validation

Before executing an action, the system checks if the agent's assumed page state matches reality:

- **Agent has current version**: Proceed normally
- **Agent has stale version (in history)**: Report what changed, then execute
- **Agent has very old version**: Warn and start fresh from current state

This prevents agents from operating on outdated assumptions.

## Safety Invariants

1. Baseline exists before any delta computation
2. Baseline advances only after delta delivery
3. Overlay mode freezes base page baseline
4. All refs include frame and loader scoping
5. Invalidations are always explicit
6. DOM stabilization has hard timeout bounds
7. Version numbers never decrease
8. Frame tracker initialized before ref creation
9. Removed refs captured before map updates
10. Format functions receive frameTracker for serialization
11. Removed refs use original loaderId (not current)

## Fallback Triggers

Full snapshot instead of delta when:

- First interaction (no baseline)
- Full page navigation detected
- Delta confidence < 60% (too many changes)
- Agent version not in history
- Major frame invalidations
- Explicit agent request

## Implementation Requirements

### Snapshot Compiler

Must capture `loader_id` for each node by:

1. Querying `Page.getFrameTree()` for frame states
2. Looking up each node's frame to get its loaderId
3. Including loader_id in serialized node data

### Tool Integration

All mutating tools should use the `executeWithDelta` wrapper which:

1. Validates agent's version against current state
2. Executes the action
3. Waits for DOM stabilization
4. Computes and returns appropriate response (delta or full)

## Benefits

- **Token efficiency**: 60-90% reduction for incremental changes
- **Agent clarity**: Clear picture of what changed
- **Reliability**: Explicit invalidation prevents stale ref errors
- **Robustness**: Bounded operations prevent hangs
- **Flexibility**: Automatic fallback when deltas are unreliable

## Trade-offs

- **Complexity**: More state to manage than simple full snapshots
- **Memory**: Version history and ref tracking consume memory
- **Latency**: Pre-validation adds a check before each action

The trade-offs are acceptable given the significant token savings and improved agent experience.

## TODOs / Risks

- Baseline could advance before an action finishes; decide on rollback or defer advance.
- Ref serialization may use current loaderId instead of node loader_id; can mismatch on navigation.
- Overlay replacement compares only backend_node_id; should include frame/loader scoping.
- Snapshot compiler fallback `loader_id: 'unknown'` breaks ref uniqueness; force full snapshot or error.
- Overlay detection uses non-null ref creation; handle missing frames safely.
- Delta reliability threshold is inconsistent (`confidence < 0.6` vs 40% change ratio).
