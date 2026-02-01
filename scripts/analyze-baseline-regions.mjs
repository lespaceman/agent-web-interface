import { AutoTokenizer } from "@xenova/transformers";
import { readFileSync } from "fs";

const SESSION_FILE = process.argv[2];
if (!SESSION_FILE) {
  console.error(
    "Usage: node analyze-baseline-regions.mjs <session-jsonl-file>\n" +
      "Find the latest session file with:\n" +
      '  ls -t ~/.claude/projects/$(echo "$PWD" | sed \'s|/|-|g; s|^-||\')/*.jsonl | head -1'
  );
  process.exit(1);
}

async function main() {
  const tokenizer = await AutoTokenizer.from_pretrained(
    "Xenova/claude-tokenizer"
  );

  const lines = readFileSync(SESSION_FILE, "utf-8").trim().split("\n");
  const messages = lines.map((l) => JSON.parse(l));

  // Collect all MCP tool calls and their responses
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

  // Collect tool results
  const toolResults = new Map();
  for (const msg of messages) {
    if (msg.type !== "user") continue;
    const content = msg.message?.content || [];
    for (const block of content) {
      if (block.type === "tool_result" && block.tool_use_id) {
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

  function countTokens(text) {
    if (!text || text.length === 0) return 0;
    return tokenizer.encode(text).length;
  }

  // Auto-detect baseline responses: those containing <baseline or multiple <region> tags
  // These are the large, full-page snapshots worth analyzing
  function isBaseline(xml) {
    if (!xml) return false;
    // Has <baseline> tag or has 2+ <region> tags (full page)
    const hasBaseline = /<baseline /.test(xml);
    const regionCount = (xml.match(/<region name="/g) || []).length;
    return hasBaseline || regionCount >= 2;
  }

  // Parse XML response into regions
  function parseRegions(xml) {
    const regions = {};

    const firstRegionIdx = xml.search(/<region /);
    const firstObsIdx = xml.search(/<observations/);
    let headerEnd = xml.length;
    if (firstRegionIdx > -1) headerEnd = Math.min(headerEnd, firstRegionIdx);
    if (firstObsIdx > -1) headerEnd = Math.min(headerEnd, firstObsIdx);

    const header = xml.slice(0, headerEnd);
    if (header.trim()) {
      regions["_header (state/meta/diff)"] = header;
    }

    const obsMatch = xml.match(/<observations[\s\S]*?<\/observations>/g);
    if (obsMatch) {
      regions["_observations"] = obsMatch.join("\n");
    }

    const regionRegex = /<region name="([^"]+)">([\s\S]*?)<\/region>/g;
    let match;
    while ((match = regionRegex.exec(xml)) !== null) {
      regions[match[1]] = match[0];
    }

    const lastRegionEnd = xml.lastIndexOf("</region>");
    if (lastRegionEnd > -1) {
      const trailer = xml.slice(lastRegionEnd + "</region>".length);
      if (trailer.trim()) {
        regions["_trailer"] = trailer;
      }
    }

    return regions;
  }

  // Extract all eids from an XML string
  function extractEids(xml) {
    const eids = new Set();
    const eidRegex = /\bid="([^"]+)"/g;
    let match;
    while ((match = eidRegex.exec(xml)) !== null) {
      eids.add(match[1]);
    }
    return eids;
  }

  // Find baseline responses and assign step numbers
  const baselineSteps = [];
  let stepCounter = 0;
  for (const call of toolCalls) {
    stepCounter++;
    const responseXml = toolResults.get(call.id) || "";
    if (isBaseline(responseXml) && countTokens(responseXml) > 500) {
      baselineSteps.push({ step: stepCounter, call, responseXml });
    }
  }

  // ---- PART 1: Region-wise token breakdown ----
  console.log("# Region-wise Token Breakdown for Baseline Snapshots\n");
  console.log(`Found ${baselineSteps.length} baseline snapshots out of ${toolCalls.length} total MCP calls.\n`);

  const allStepEids = new Map();

  for (const { step, call, responseXml } of baselineSteps) {
    const totalTokens = countTokens(responseXml);

    console.log(
      `## Step ${step}: \`${call.name}\` (${totalTokens} total tokens)\n`
    );

    const regions = parseRegions(responseXml);

    console.log("| Region | Tokens | Chars | % of Total |");
    console.log("|--------|--------|-------|------------|");

    const regionEntries = [];
    for (const [name, text] of Object.entries(regions)) {
      const tokens = countTokens(text);
      regionEntries.push({ name, tokens, chars: text.length });
    }

    regionEntries.sort((a, b) => b.tokens - a.tokens);

    for (const { name, tokens, chars } of regionEntries) {
      const pct = ((tokens / totalTokens) * 100).toFixed(1);
      console.log(`| ${name} | ${tokens} | ${chars} | ${pct}% |`);
    }
    console.log("");

    const eids = extractEids(responseXml);
    allStepEids.set(step, eids);
  }

  // ---- PART 2: Repeated eids across baselines ----
  console.log("\n# Repeated Element IDs Across Baselines\n");

  const eidToSteps = new Map();
  for (const [step, eids] of allStepEids) {
    for (const eid of eids) {
      if (!eidToSteps.has(eid)) eidToSteps.set(eid, []);
      eidToSteps.get(eid).push(step);
    }
  }

  const repeated = [];
  for (const [eid, steps] of eidToSteps) {
    if (steps.length >= 2) {
      repeated.push({ eid, steps, count: steps.length });
    }
  }

  repeated.sort((a, b) => b.count - a.count || a.eid.localeCompare(b.eid));

  console.log(
    `Total unique eids across all ${baselineSteps.length} baselines: ${eidToSteps.size}`
  );
  console.log(`Eids appearing in 2+ baselines: ${repeated.length}\n`);

  if (repeated.length > 0) {
    const byStepCombo = new Map();
    for (const { eid, steps } of repeated) {
      const key = steps.sort((a, b) => a - b).join(",");
      if (!byStepCombo.has(key)) byStepCombo.set(key, []);
      byStepCombo.get(key).push(eid);
    }

    console.log("| Steps Present | # Shared EIDs | Example EIDs |");
    console.log("|---------------|---------------|--------------|");
    const combos = [...byStepCombo.entries()].sort(
      (a, b) => b[1].length - a[1].length
    );
    for (const [steps, eids] of combos) {
      const examples = eids.slice(0, 4).join(", ");
      const suffix =
        eids.length > 4 ? `, ... (+${eids.length - 4} more)` : "";
      console.log(`| ${steps} | ${eids.length} | ${examples}${suffix} |`);
    }

    // Sample repeated eids to show what they are
    console.log("\n### What are these shared elements?\n");
    console.log(
      "Sampling repeated eids to identify their element type/label:\n"
    );

    const topCombo = combos[0];
    const topSteps = topCombo[0].split(",").map(Number);
    const sampleEids = topCombo[1].slice(0, 10);

    // Find the baseline entry for the first step in the top combo
    const firstBaseline = baselineSteps.find((b) => b.step === topSteps[0]);
    const firstStepXml = firstBaseline ? firstBaseline.responseXml : "";

    console.log("| EID | Element Context |");
    console.log("|-----|----------------|");
    for (const eid of sampleEids) {
      const escapedEid = eid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const lineRegex = new RegExp(`.*id="${escapedEid}"[^>]*>[^<]*`, "");
      const match = firstStepXml.match(lineRegex);
      if (match) {
        let context = match[0].trim();
        if (context.length > 100) context = context.slice(0, 100) + "...";
        console.log(`| ${eid} | \`${context}\` |`);
      }
    }

    // Token cost of repeated content per baseline
    console.log("\n### Token cost of repeated eids\n");

    for (const { step, call, responseXml } of baselineSteps) {
      const totalTokens = countTokens(responseXml);
      const stepEids = allStepEids.get(step);

      let repeatedLines = [];
      for (const eid of stepEids) {
        const appearances = eidToSteps.get(eid);
        if (appearances.length >= 2) {
          const escapedEid = eid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const lineRegex = new RegExp(
            `\\s*<[^>]*id="${escapedEid}"[^>]*>[^<]*</[^>]+>`,
            ""
          );
          const match = responseXml.match(lineRegex);
          if (match) repeatedLines.push(match[0]);
        }
      }

      const repeatedText = repeatedLines.join("\n");
      const repeatedTokens = countTokens(repeatedText);
      const pct =
        totalTokens > 0
          ? ((repeatedTokens / totalTokens) * 100).toFixed(1)
          : "0";

      console.log(
        `Step ${step}: ${repeatedTokens} repeated-eid tokens out of ${totalTokens} (${pct}%)`
      );
    }
  }
}

main().catch(console.error);
