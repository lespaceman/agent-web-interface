import { AutoTokenizer } from "@xenova/transformers";
import { readFileSync } from "fs";

const SESSION_FILE = process.argv[2];
if (!SESSION_FILE) {
  console.error(
    "Usage: node count-tool-tokens.mjs <session-jsonl-file>\n" +
      "Find the latest session file with:\n" +
      '  ls -t ~/.claude/projects/$(echo "$PWD" | sed \'s|/|-|g; s|^-||\')/*.jsonl | head -1'
  );
  process.exit(1);
}

async function main() {
  // Load Claude tokenizer
  const tokenizer = await AutoTokenizer.from_pretrained(
    "Xenova/claude-tokenizer"
  );

  const lines = readFileSync(SESSION_FILE, "utf-8").trim().split("\n");
  const messages = lines.map((l) => JSON.parse(l));

  // Extract MCP tool calls (from assistant messages)
  const toolCalls = [];
  for (const msg of messages) {
    if (msg.type !== "assistant") continue;
    const content = msg.message?.content || [];
    for (const block of content) {
      if (
        block.type === "tool_use" &&
        (block.name || "").includes("athena-browser-mcp")
      ) {
        toolCalls.push({
          name: block.name.replace("mcp__athena-browser-mcp-dev__", ""),
          input: block.input,
          id: block.id,
        });
      }
    }
  }

  // Extract tool results (from user messages with tool_result)
  const toolResults = new Map();
  for (const msg of messages) {
    if (msg.type !== "user") continue;
    const content = msg.message?.content || [];
    for (const block of content) {
      if (block.type === "tool_result" && block.tool_use_id) {
        // Content can be string or array of blocks
        let text = "";
        if (typeof block.content === "string") {
          text = block.content;
        } else if (Array.isArray(block.content)) {
          text = block.content.map((b) => b.text || "").join("");
        }
        toolResults.set(block.tool_use_id, text);
      }
    }
  }

  // Count tokens for each call
  console.log("| # | Tool | Input Tokens | Response Tokens | Response Chars |");
  console.log("|---|------|-------------|-----------------|----------------|");

  let totalInputTokens = 0;
  let totalResponseTokens = 0;

  for (let i = 0; i < toolCalls.length; i++) {
    const call = toolCalls[i];
    const inputText = JSON.stringify(call.input);
    const responseText = toolResults.get(call.id) || "(no response found)";

    const inputTokens = tokenizer.encode(inputText).length;
    const responseTokens = tokenizer.encode(responseText).length;

    totalInputTokens += inputTokens;
    totalResponseTokens += responseTokens;

    console.log(
      `| ${i + 1} | \`${call.name}\` | ${inputTokens} | ${responseTokens} | ${responseText.length} |`
    );
  }

  console.log("|---|------|-------------|-----------------|----------------|");
  console.log(
    `| | **Total** | **${totalInputTokens}** | **${totalResponseTokens}** | |`
  );
  console.log(
    `\nGrand total (input + response): ${totalInputTokens + totalResponseTokens} tokens`
  );
}

main().catch(console.error);
