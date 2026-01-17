# MCP (Model Context Protocol) Reference Guide

> Comprehensive documentation for building MCP servers and clients

## Table of Contents

1. [Overview](#overview)
2. [Core Concepts](#core-concepts)
3. [TypeScript SDK](#typescript-sdk)
4. [Python SDK](#python-sdk)
5. [Transport Options](#transport-options)
6. [Building Servers](#building-servers)
7. [Building Clients](#building-clients)
8. [Security & Best Practices](#security--best-practices)
9. [Configuration](#configuration)
10. [Troubleshooting](#troubleshooting)

---

## Overview

The Model Context Protocol (MCP) is a standardized protocol for connecting LLMs (like Claude) with external tools, data sources, and services. It enables applications to supply context to language models in a consistent, secure way.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         MCP Host                                │
│  (Claude Desktop, IDE, or Custom Application)                   │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ MCP Client  │  │ MCP Client  │  │ MCP Client  │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
└─────────┼────────────────┼────────────────┼─────────────────────┘
          │                │                │
    ┌─────▼─────┐    ┌─────▼─────┐    ┌─────▼─────┐
    │MCP Server │    │MCP Server │    │MCP Server │
    │(Database) │    │  (Files)  │    │  (APIs)   │
    └───────────┘    └───────────┘    └───────────┘
```

### Communication Flow

```
1. Client requests available tools from server
2. Client sends user query to LLM with tool descriptions
3. LLM decides which tools (if any) to use
4. Client executes tool calls through the server
5. Server returns results to client
6. Client sends results back to LLM
7. LLM provides natural language response
8. Client displays response to user
```

---

## Core Concepts

MCP servers provide three primary types of capabilities:

### 1. Resources

File-like data that can be read by clients. Similar to GET endpoints in REST APIs.

- Expose data without heavy computation
- Support dynamic URI templates
- Examples: API responses, file contents, database records

### 2. Tools

Functions that can be called by the LLM (with user approval).

- Enable actions and computations
- Support structured input/output schemas
- Examples: Database queries, API calls, file operations

### 3. Prompts

Pre-written templates to help users accomplish specific tasks.

- Reusable message templates
- Declare arguments for customization
- Return structured message sequences

---

## TypeScript SDK

### Installation

```bash
# Server package
npm install @modelcontextprotocol/server zod

# Client package
npm install @modelcontextprotocol/client zod
```

> **Note:** Both packages require `zod` as a peer dependency for schema validation.

### Server Example

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Create server instance
const server = new McpServer({
  name: 'my-server',
  version: '1.0.0',
});

// Register a tool
server.registerTool(
  'get_weather',
  {
    description: 'Get weather for a location',
    inputSchema: {
      city: z.string().describe('City name'),
      country: z.string().optional().describe('Country code'),
    },
  },
  async ({ city, country }) => {
    // Implementation
    const weather = await fetchWeather(city, country);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(weather, null, 2),
        },
      ],
    };
  }
);

// Register a resource
server.registerResource(
  'config://settings',
  {
    description: 'Application settings',
    mimeType: 'application/json',
  },
  async () => {
    return {
      contents: [
        {
          uri: 'config://settings',
          mimeType: 'application/json',
          text: JSON.stringify({ theme: 'dark', language: 'en' }),
        },
      ],
    };
  }
);

// Register a prompt
server.registerPrompt(
  'analyze_code',
  {
    description: 'Analyze code for issues',
    arguments: [
      {
        name: 'language',
        description: 'Programming language',
        required: true,
      },
    ],
  },
  async ({ language }) => {
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Analyze the following ${language} code for potential issues...`,
          },
        },
      ],
    };
  }
);

// Start server with stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Server started'); // Use stderr for logs
}

main().catch(console.error);
```

### Client Example

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

class MCPClient {
  private client: Client;
  private transport: StdioClientTransport | StreamableHTTPClientTransport;

  constructor() {
    this.client = new Client({
      name: 'my-client',
      version: '1.0.0',
    });
  }

  // Connect to a local server via stdio
  async connectStdio(command: string, args: string[]) {
    this.transport = new StdioClientTransport({ command, args });
    await this.client.connect(this.transport);
  }

  // Connect to a remote server via HTTP
  async connectHttp(url: string) {
    this.transport = new StreamableHTTPClientTransport(new URL(url));
    await this.client.connect(this.transport);
  }

  // List available tools
  async listTools() {
    const result = await this.client.listTools();
    return result.tools;
  }

  // Call a tool
  async callTool(name: string, args: Record<string, unknown>) {
    const result = await this.client.callTool({ name, arguments: args });
    return result;
  }

  // List resources
  async listResources() {
    const result = await this.client.listResources();
    return result.resources;
  }

  // Read a resource
  async readResource(uri: string) {
    const result = await this.client.readResource({ uri });
    return result;
  }

  // Get a prompt
  async getPrompt(name: string, args: Record<string, string>) {
    const result = await this.client.getPrompt({ name, arguments: args });
    return result;
  }

  async disconnect() {
    await this.client.close();
  }
}
```

---

## Python SDK

### Installation

```bash
# Using UV (recommended)
uv add "mcp[cli]"

# Using pip
pip install "mcp[cli]"
```

### Server Example (FastMCP)

```python
from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.context import Context
from mcp.server.session import ServerSession
import httpx

# Create server
mcp = FastMCP("my-server")

# Register a tool
@mcp.tool()
async def get_weather(city: str, country: str = "US") -> str:
    """Get weather for a location.

    Args:
        city: City name
        country: Country code (default: US)
    """
    async with httpx.AsyncClient() as client:
        response = await client.get(f"https://api.weather.com/{city}")
        return response.text

# Tool with progress reporting
@mcp.tool()
async def long_running_task(
    data: str,
    ctx: Context[ServerSession, None]
) -> str:
    """A task that takes time and reports progress."""
    await ctx.report_progress(progress=0, total=100)

    # Do work...
    await ctx.report_progress(progress=50, total=100)

    # More work...
    await ctx.report_progress(progress=100, total=100)

    return "Task completed"

# Register a resource
@mcp.resource("file://documents/{name}")
def read_document(name: str) -> str:
    """Read a document by name."""
    with open(f"documents/{name}", "r") as f:
        return f.read()

# Dynamic resource with template
@mcp.resource("db://users/{user_id}")
async def get_user(user_id: str) -> dict:
    """Get user data from database."""
    return {"id": user_id, "name": "John Doe"}

# Register a prompt
@mcp.prompt()
def code_review_prompt(language: str, style: str = "thorough") -> str:
    """Generate a code review prompt.

    Args:
        language: Programming language
        style: Review style (quick/thorough)
    """
    return f"Please review this {language} code. Be {style} in your analysis."

# Structured output with Pydantic
from pydantic import BaseModel

class AnalysisResult(BaseModel):
    score: float
    issues: list[str]
    suggestions: list[str]

@mcp.tool()
async def analyze_code(code: str) -> AnalysisResult:
    """Analyze code and return structured results."""
    return AnalysisResult(
        score=8.5,
        issues=["Line too long on line 42"],
        suggestions=["Consider using a constant for magic number"]
    )

# Run server
if __name__ == "__main__":
    mcp.run(transport="stdio")  # or "streamable-http"
```

### Client Example

```python
import asyncio
from contextlib import AsyncExitStack
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

class MCPClient:
    def __init__(self):
        self.session: ClientSession | None = None
        self.exit_stack = AsyncExitStack()

    async def connect(self, command: str, args: list[str]):
        """Connect to an MCP server."""
        server_params = StdioServerParameters(
            command=command,
            args=args,
            env=None
        )

        stdio_transport = await self.exit_stack.enter_async_context(
            stdio_client(server_params)
        )
        self.read, self.write = stdio_transport

        self.session = await self.exit_stack.enter_async_context(
            ClientSession(self.read, self.write)
        )

        await self.session.initialize()

        # List available tools
        response = await self.session.list_tools()
        print(f"Connected with tools: {[t.name for t in response.tools]}")

    async def list_tools(self):
        """List available tools."""
        response = await self.session.list_tools()
        return response.tools

    async def call_tool(self, name: str, arguments: dict):
        """Call a tool."""
        result = await self.session.call_tool(name, arguments)
        return result

    async def list_resources(self):
        """List available resources."""
        response = await self.session.list_resources()
        return response.resources

    async def read_resource(self, uri: str):
        """Read a resource."""
        result = await self.session.read_resource(uri)
        return result

    async def disconnect(self):
        """Disconnect from server."""
        await self.exit_stack.aclose()

# Usage
async def main():
    client = MCPClient()
    await client.connect("python", ["server.py"])

    tools = await client.list_tools()
    print(f"Available tools: {tools}")

    result = await client.call_tool("get_weather", {"city": "London"})
    print(f"Weather: {result}")

    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
```

---

## Transport Options

### 1. Stdio Transport

Best for local process communication.

```typescript
// TypeScript Server
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
const transport = new StdioServerTransport();
await server.connect(transport);

// TypeScript Client
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const transport = new StdioClientTransport({
  command: 'node',
  args: ['server.js'],
});
await client.connect(transport);
```

```python
# Python Server
mcp.run(transport="stdio")

# Python Client
server_params = StdioServerParameters(
    command="python",
    args=["server.py"]
)
```

### 2. Streamable HTTP Transport (Recommended for Remote)

Modern transport supporting HTTP POST and SSE.

```typescript
// TypeScript Server
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';

const app = createMcpExpressApp(server, {
  allowedHosts: ['localhost', 'myapp.com'],
});
app.listen(3000);

// TypeScript Client
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const transport = new StreamableHTTPClientTransport(new URL('http://localhost:3000/mcp'));
await client.connect(transport);
```

```python
# Python Server
mcp.run(transport="streamable-http", port=3000)
```

### 3. SSE Transport (Deprecated)

Legacy transport for backwards compatibility.

```typescript
// Only use for older clients/servers
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
```

### Transport Selection Guide

| Use Case          | Transport       | Notes                 |
| ----------------- | --------------- | --------------------- |
| Local CLI tool    | stdio           | Simple, fast          |
| Remote API server | Streamable HTTP | Modern, recommended   |
| Legacy systems    | SSE             | Backwards compat only |
| Claude Desktop    | stdio           | Standard integration  |

---

## Building Servers

### Complete TypeScript Server Template

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'example-server',
  version: '1.0.0',
  capabilities: {
    tools: {},
    resources: {},
    prompts: {},
  },
});

// === TOOLS ===

// Simple tool
server.registerTool(
  'echo',
  {
    description: 'Echo back the input',
    inputSchema: {
      message: z.string().describe('Message to echo'),
    },
  },
  async ({ message }) => ({
    content: [{ type: 'text', text: message }],
  })
);

// Tool with complex input
server.registerTool(
  'query_database',
  {
    description: 'Execute a database query',
    inputSchema: {
      query: z.string().describe('SQL query'),
      params: z.array(z.string()).optional().describe('Query parameters'),
      limit: z.number().default(100).describe('Max results'),
    },
  },
  async ({ query, params, limit }) => {
    // Execute query...
    const results = await db.query(query, params, limit);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(results, null, 2),
        },
      ],
    };
  }
);

// Tool returning multiple content types
server.registerTool(
  'generate_chart',
  {
    description: 'Generate a chart from data',
    inputSchema: {
      data: z.array(z.number()).describe('Data points'),
      type: z.enum(['bar', 'line', 'pie']).describe('Chart type'),
    },
  },
  async ({ data, type }) => {
    const chartBuffer = await generateChart(data, type);
    return {
      content: [
        { type: 'text', text: `Generated ${type} chart with ${data.length} points` },
        {
          type: 'image',
          data: chartBuffer.toString('base64'),
          mimeType: 'image/png',
        },
      ],
    };
  }
);

// === RESOURCES ===

// Static resource
server.registerResource(
  'info://version',
  {
    description: 'Server version info',
    mimeType: 'application/json',
  },
  async () => ({
    contents: [
      {
        uri: 'info://version',
        mimeType: 'application/json',
        text: JSON.stringify({ version: '1.0.0', build: '2024-01-01' }),
      },
    ],
  })
);

// Dynamic resource with template
server.registerResourceTemplate(
  'file://documents/{path}',
  {
    description: 'Read a document file',
    mimeType: 'text/plain',
  },
  async ({ path }) => {
    const content = await fs.readFile(`documents/${path}`, 'utf-8');
    return {
      contents: [
        {
          uri: `file://documents/${path}`,
          mimeType: 'text/plain',
          text: content,
        },
      ],
    };
  }
);

// === PROMPTS ===

server.registerPrompt(
  'summarize',
  {
    description: 'Summarize content',
    arguments: [
      { name: 'content', description: 'Content to summarize', required: true },
      { name: 'length', description: 'Summary length (short/medium/long)', required: false },
    ],
  },
  async ({ content, length = 'medium' }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Summarize the following content in a ${length} format:\n\n${content}`,
        },
      },
    ],
  })
);

// === START SERVER ===

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP Server started'); // Always use stderr for logs!
}

main().catch(console.error);
```

### Complete Python Server Template

```python
from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.context import Context
from mcp.server.session import ServerSession
from pydantic import BaseModel, Field
from typing import Optional
import asyncio
import logging

# Configure logging (important: use stderr)
logging.basicConfig(level=logging.INFO, handlers=[logging.StreamHandler()])
logger = logging.getLogger(__name__)

# Create server
mcp = FastMCP(
    "example-server",
    version="1.0.0",
    json_response=True  # Enable structured output
)

# === TOOLS ===

@mcp.tool()
async def echo(message: str) -> str:
    """Echo back the input message.

    Args:
        message: The message to echo back
    """
    return message

@mcp.tool()
async def query_database(
    query: str,
    params: Optional[list[str]] = None,
    limit: int = 100
) -> dict:
    """Execute a database query.

    Args:
        query: SQL query to execute
        params: Optional query parameters
        limit: Maximum number of results (default: 100)
    """
    # Execute query...
    results = await db.query(query, params or [], limit)
    return {"results": results, "count": len(results)}

# Tool with progress reporting
@mcp.tool()
async def process_files(
    paths: list[str],
    ctx: Context[ServerSession, None]
) -> dict:
    """Process multiple files with progress tracking.

    Args:
        paths: List of file paths to process
    """
    results = []
    total = len(paths)

    for i, path in enumerate(paths):
        await ctx.report_progress(progress=i, total=total)
        result = await process_single_file(path)
        results.append(result)

    await ctx.report_progress(progress=total, total=total)
    return {"processed": len(results), "results": results}

# Structured output with Pydantic
class AnalysisResult(BaseModel):
    score: float = Field(description="Quality score 0-10")
    issues: list[str] = Field(description="List of issues found")
    suggestions: list[str] = Field(description="Improvement suggestions")

@mcp.tool()
async def analyze_code(code: str, language: str) -> AnalysisResult:
    """Analyze code quality and return structured feedback.

    Args:
        code: Source code to analyze
        language: Programming language
    """
    # Perform analysis...
    return AnalysisResult(
        score=8.5,
        issues=["Line 42 is too long"],
        suggestions=["Consider extracting method"]
    )

# === RESOURCES ===

@mcp.resource("info://version")
def get_version() -> dict:
    """Get server version information."""
    return {"version": "1.0.0", "build": "2024-01-01"}

@mcp.resource("file://documents/{path}")
async def read_document(path: str) -> str:
    """Read a document file.

    Args:
        path: Relative path to the document
    """
    with open(f"documents/{path}", "r") as f:
        return f.read()

@mcp.resource("db://users/{user_id}")
async def get_user(user_id: str) -> dict:
    """Get user data from database.

    Args:
        user_id: User ID to look up
    """
    user = await db.get_user(user_id)
    return user.dict()

# === PROMPTS ===

@mcp.prompt()
def summarize(content: str, length: str = "medium") -> str:
    """Generate a summarization prompt.

    Args:
        content: Content to summarize
        length: Summary length (short/medium/long)
    """
    return f"Summarize the following content in a {length} format:\n\n{content}"

@mcp.prompt()
def code_review(language: str, focus: str = "general") -> list[dict]:
    """Generate a code review prompt with system context.

    Args:
        language: Programming language
        focus: Review focus area
    """
    return [
        {
            "role": "system",
            "content": f"You are an expert {language} code reviewer focusing on {focus}."
        },
        {
            "role": "user",
            "content": "Please review the following code and provide detailed feedback."
        }
    ]

# === SERVER LIFECYCLE ===

@mcp.on_startup
async def startup():
    """Initialize resources on server start."""
    logger.info("Server starting up...")
    await db.connect()

@mcp.on_shutdown
async def shutdown():
    """Cleanup on server shutdown."""
    logger.info("Server shutting down...")
    await db.disconnect()

# === RUN SERVER ===

if __name__ == "__main__":
    # stdio for CLI/desktop integration
    mcp.run(transport="stdio")

    # OR streamable-http for remote access
    # mcp.run(transport="streamable-http", port=3000)
```

---

## Building Clients

### Integration with Anthropic API

```typescript
import { Anthropic } from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

class MCPChatClient {
  private mcp: Client;
  private anthropic: Anthropic;
  private tools: any[] = [];

  constructor() {
    this.anthropic = new Anthropic();
    this.mcp = new Client({ name: 'chat-client', version: '1.0.0' });
  }

  async connect(serverPath: string) {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath],
    });
    await this.mcp.connect(transport);

    // Get tools from MCP server
    const result = await this.mcp.listTools();
    this.tools = result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
  }

  async chat(userMessage: string): Promise<string> {
    const messages: any[] = [{ role: 'user', content: userMessage }];

    // Initial Claude call
    let response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages,
      tools: this.tools,
    });

    // Handle tool calls in a loop
    while (response.stop_reason === 'tool_use') {
      const toolUse = response.content.find((c) => c.type === 'tool_use');
      if (!toolUse) break;

      // Execute tool via MCP
      const toolResult = await this.mcp.callTool({
        name: toolUse.name,
        arguments: toolUse.input,
      });

      // Add assistant response and tool result
      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: toolResult.content,
          },
        ],
      });

      // Continue conversation
      response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages,
        tools: this.tools,
      });
    }

    // Extract final text response
    const textContent = response.content.find((c) => c.type === 'text');
    return textContent?.text || '';
  }
}
```

```python
from anthropic import Anthropic
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from contextlib import AsyncExitStack

class MCPChatClient:
    def __init__(self):
        self.anthropic = Anthropic()
        self.session: ClientSession | None = None
        self.exit_stack = AsyncExitStack()
        self.tools = []

    async def connect(self, command: str, args: list[str]):
        """Connect to MCP server and fetch tools."""
        server_params = StdioServerParameters(command=command, args=args)

        stdio_transport = await self.exit_stack.enter_async_context(
            stdio_client(server_params)
        )
        read, write = stdio_transport

        self.session = await self.exit_stack.enter_async_context(
            ClientSession(read, write)
        )
        await self.session.initialize()

        # Get tools
        response = await self.session.list_tools()
        self.tools = [
            {
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.inputSchema
            }
            for tool in response.tools
        ]

    async def chat(self, user_message: str) -> str:
        """Chat with tool support."""
        messages = [{"role": "user", "content": user_message}]

        # Initial Claude call
        response = self.anthropic.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            messages=messages,
            tools=self.tools
        )

        # Handle tool calls
        while response.stop_reason == "tool_use":
            tool_use = next(
                (c for c in response.content if c.type == "tool_use"),
                None
            )
            if not tool_use:
                break

            # Execute via MCP
            tool_result = await self.session.call_tool(
                tool_use.name,
                tool_use.input
            )

            # Continue conversation
            messages.append({"role": "assistant", "content": response.content})
            messages.append({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": tool_use.id,
                    "content": tool_result.content
                }]
            })

            response = self.anthropic.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=4096,
                messages=messages,
                tools=self.tools
            )

        # Return text response
        text_content = next(
            (c for c in response.content if c.type == "text"),
            None
        )
        return text_content.text if text_content else ""

    async def disconnect(self):
        await self.exit_stack.aclose()
```

---

## Security & Best Practices

### Logging (Critical for STDIO)

**NEVER write to stdout in STDIO servers - it corrupts JSON-RPC messages!**

```python
# ❌ BAD - Corrupts protocol
print("Processing request")
print(f"Debug: {data}")

# ✅ GOOD - Use stderr or logging
import logging
logging.info("Processing request")
logging.debug(f"Debug: {data}")

# ✅ GOOD - Write to stderr explicitly
import sys
print("Debug info", file=sys.stderr)
```

```typescript
// ❌ BAD
console.log('Processing request');

// ✅ GOOD
console.error('Processing request');
```

### Input Validation

```typescript
server.registerTool(
  'execute_query',
  {
    inputSchema: {
      query: z
        .string()
        .max(1000)
        .refine((q) => !q.toLowerCase().includes('drop'), {
          message: 'DROP statements not allowed',
        }),
    },
  },
  async ({ query }) => {
    // Safe to execute
  }
);
```

### Error Handling

```typescript
server.registerTool('risky_operation', { inputSchema: { data: z.string() } }, async ({ data }) => {
  try {
    const result = await performOperation(data);
    return { content: [{ type: 'text', text: result }] };
  } catch (error) {
    // Return error as content, don't throw
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});
```

### DNS Rebinding Protection (HTTP Servers)

```typescript
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';

const app = createMcpExpressApp(server, {
  // Automatically enabled for localhost/127.0.0.1
  // For 0.0.0.0, explicitly set allowed hosts
  allowedHosts: ['myapp.com', 'api.myapp.com'],
});
```

---

## Configuration

### Claude Desktop Configuration

Location:

- **macOS/Linux**: `~/.config/Claude/claude_desktop_config.json`
- **Windows**: `%AppData%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["/absolute/path/to/server.js"]
    },
    "python-server": {
      "command": "python",
      "args": ["/absolute/path/to/server.py"]
    },
    "uv-server": {
      "command": "uv",
      "args": ["--directory", "/absolute/path/to/project", "run", "server.py"]
    }
  }
}
```

### Environment Variables

```json
{
  "mcpServers": {
    "database-server": {
      "command": "node",
      "args": ["server.js"],
      "env": {
        "DATABASE_URL": "postgresql://localhost:5432/mydb",
        "API_KEY": "your-api-key"
      }
    }
  }
}
```

---

## Troubleshooting

### Common Issues

| Issue                   | Cause              | Solution                 |
| ----------------------- | ------------------ | ------------------------ |
| `FileNotFoundError`     | Wrong path         | Use absolute paths       |
| `Connection refused`    | Server not running | Check server process     |
| `Tool execution failed` | Missing env vars   | Set required environment |
| `Timeout errors`        | Slow operation     | Increase timeout         |
| `First response slow`   | Normal startup     | Wait ~30 seconds         |
| `Corrupted messages`    | Logging to stdout  | Use stderr/logging       |

### Debugging Steps

1. **Check server logs**

   ```bash
   # Run server manually to see errors
   node server.js 2>&1
   python server.py 2>&1
   ```

2. **Use MCP Inspector**

   ```bash
   npx @modelcontextprotocol/inspector node server.js
   ```

3. **Verify configuration**

   ```bash
   # Check config file syntax
   cat ~/.config/Claude/claude_desktop_config.json | jq .
   ```

4. **Test tools manually**
   ```typescript
   // Add debug logging
   server.registerTool('test', { inputSchema: {} }, async () => {
     console.error('Tool called!'); // stderr
     return { content: [{ type: 'text', text: 'OK' }] };
   });
   ```

### Protocol Version Compatibility

```typescript
// Handle both new and legacy clients
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

async function connectWithFallback(url: string) {
  try {
    // Try modern transport first
    const transport = new StreamableHTTPClientTransport(new URL(url));
    await client.connect(transport);
  } catch (e) {
    // Fall back to legacy SSE
    const transport = new SSEClientTransport(new URL(url));
    await client.connect(transport);
  }
}
```

---

## Additional Resources

- **Full Documentation**: https://modelcontextprotocol.io/llms-full.txt
- **TypeScript SDK**: https://github.com/modelcontextprotocol/typescript-sdk
- **Python SDK**: https://github.com/modelcontextprotocol/python-sdk
- **MCP Inspector**: `npx @modelcontextprotocol/inspector`
- **Example Servers**: https://github.com/modelcontextprotocol/servers

---

_Generated from MCP documentation - January 2025_
