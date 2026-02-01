---
description: Navigate apple.com, add iPhone 17 to cart, and generate a documented tool-use example with token analysis
allowed-tools: mcp__athena-browser-mcp__navigate, mcp__athena-browser-mcp__click, mcp__athena-browser-mcp__find_elements, mcp__athena-browser-mcp__scroll_page, mcp__athena-browser-mcp__scroll_element_into_view, mcp__athena-browser-mcp__capture_snapshot, mcp__athena-browser-mcp__close_session, mcp__athena-browser-mcp__type, mcp__athena-browser-mcp__get_element_details, Read, Write, Bash, Glob, Edit
---

# Generate Apple.com iPhone-to-Cart Tool Use Example

You are generating a documented tool-use example for athena-browser-mcp. You will drive a live browser session through apple.com's iPhone purchase flow, record every tool call and response, then produce a comprehensive markdown document with token analysis.

## Output File

Write the final document to: `docs/examples/tool-use-example-add-iphone-to-cart.md`

## Phase 1: Browser Automation

Execute the following steps using athena-browser-mcp tools. After EACH tool call, record:

- The tool name (without the `mcp__athena-browser-mcp__` prefix)
- The exact input JSON you sent
- The full XML response you received (you will trim it later for the doc)

### Step-by-step flow

1. **`navigate`** to `https://www.apple.com`
   - If a country/region selector overlay appears, dismiss it by clicking the close button.

2. **`click`** the "iPhone" link in the nav region.

3. On the iPhone landing page, **`click`** the "Buy, iPhone 17" link.
   - If iPhone 17 is not listed, use the latest available iPhone model and note this in the doc.

4. **`find_elements`** with `kind: "radio"`, `region: "main"`, `limit: 20` to discover all configuration options.

5. Configure the iPhone by clicking radio buttons in sequence. Each selection enables the next tier:
   - **Color**: Select "Lavender" (or the first available color)
   - **Storage**: Select "256GB"
   - **Trade-in**: Select "No trade-in"
   - **Payment**: Select "Buy" (full price)
   - **Carrier**: Select "Connect to any carrier later" (unlocked)
   - **AppleCare**: Select "No AppleCare coverage"

   IMPORTANT: Wait for each tier to become enabled before clicking. If a radio button shows `enabled="false"`, you must first complete the preceding selection.

6. **`click`** the "Add to Bag" button (look for it in the `form` region with `val="add-to-cart"`).

7. After the accessories upsell page loads, **`scroll_page`** down to find the "Review Bag" button, then **`click`** it.

8. On the Bag page, verify the iPhone is in the cart by checking:
   - The nav shows "Shopping Bag with item count : 1"
   - The main region contains the product name and "Check Out" button

9. **`capture_snapshot`** to confirm the page is stable.

10. **`close_session`** to clean up.

### Handling unexpected states

- If a step fails or the page layout differs from expectations, adapt and document what happened.
- If a modal or overlay blocks interaction, dismiss it first.
- If an element is not visible, use `scroll_page` or `scroll_element_into_view` to reach it.
- Record ALL tool calls including any extra ones needed for recovery — these are valuable for the doc.

## Phase 2: Write the Documentation

After completing the browser flow, write `docs/examples/tool-use-example-add-iphone-to-cart.md` with this structure:

### Document structure

````markdown
# Tool Use Example: Add iPhone 17 to Cart on Apple.com

[1-2 sentence intro describing the walkthrough]

---

## Step N: [Short description]

**Tool:** `tool_name`

```json
{ ... input ... }
```
````

**Response (trimmed):**

```xml
[Trimmed XML — keep key elements, replace repetitive nav/footer content with <!-- ... -->]
```

**Response tokens:** [count]

**What happened:** [2-3 sentence narrative explaining the response, any state changes, and what to do next]

---

[Repeat for each step]

## Summary

[Table with columns: Step, Tool, Action, Result, Response Tokens]
[Total row at bottom]

### Token Costs

[Methodology note about Xenova/claude-tokenizer]

#### Region-wise breakdown of baseline snapshots

[For each baseline/navigation response, include a table with Region, Tokens, % of Total]
[Include analysis of nav region dominance]

#### Repeated element IDs across baselines

[Analysis of eid reuse across baselines]
[Table showing shared eids by step combination]
[Token cost of repeated eids per baseline]

### Key Observations

[6-7 numbered observations about: progressive disclosure, diff-based responses,
stable element IDs, navigation vs mutation, semantic regions, nav dominance, totals]

````

### Trimming responses

For each response in the doc:
- **Baseline snapshots (navigation)**: Keep the `<state>`, `<meta>`, `<baseline>` tags. For `<region name="nav">`, show 3-5 representative elements then `<!-- ...other nav links... -->`. Show the full `<region name="main">` content (this is what matters). For footer, show 2-3 links then truncate.
- **Diff responses (mutation)**: Show in full — they're already compact.
- **`find_elements` results**: Show the `<result>` wrapper and all `<match>` elements but truncate long labels with `...`.

## Phase 3: Token Analysis

After writing the initial doc, run the token counting script to get accurate counts.

### Step 3a: Identify the session transcript

Find the current session's JSONL transcript file by running:

```bash
ls -t ~/.claude/projects/$(echo "$PWD" | sed 's|/|-|g; s|^-||')/*.jsonl | head -1
````

Save this path to a variable — you'll pass it to the analysis scripts. Read the file to confirm it contains this session's MCP tool calls (look for `athena-browser-mcp` in the content).

### Step 3b: Count tokens per tool call

Run the token counting script, passing the session file as an argument:

```bash
node scripts/count-tool-tokens.mjs <SESSION_FILE>
```

If the script doesn't exist or errors, create it. It should:

1. Load `@xenova/transformers` with `Xenova/claude-tokenizer`
2. Accept the session JSONL path as `process.argv[2]`
3. Parse the JSONL to extract MCP tool calls and their responses
4. Count tokens for each call's input and response
5. Output a markdown table with: step number, tool name, input tokens, response tokens

### Step 3c: Region-wise analysis

Run the region analysis script, passing the same session file:

```bash
node scripts/analyze-baseline-regions.mjs <SESSION_FILE>
```

If the script doesn't exist or errors, create it. It should:

1. Parse each baseline snapshot response into `<region>` blocks
2. Count tokens per region using the Claude tokenizer
3. Extract all `id="..."` attributes from each baseline
4. Find eids appearing in 2+ baselines
5. Calculate token cost of repeated eids per baseline
6. Output markdown tables for all of the above

### Step 3d: Update the doc with token counts

Edit the markdown file to add:

- `**Response tokens:** N` after each step's response block
- The "Response Tokens" column in the summary table
- The full "Token Costs" section with region breakdown and eid analysis
- Updated Key Observations referencing the token data

## Quality Checklist

Before finishing, verify:

- [ ] Every tool call in the flow is documented as a step
- [ ] Each step has: tool name, input JSON, trimmed response, token count, narrative
- [ ] The summary table is complete with all steps and token column
- [ ] Region-wise token tables are included for all baseline snapshots
- [ ] Eid repetition analysis is present with tables
- [ ] Key Observations section references token data
- [ ] The doc is self-contained and readable without prior context
- [ ] All code blocks have correct syntax highlighting (json, xml, markdown)
