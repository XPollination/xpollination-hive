import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

const BRAIN_API = "http://localhost:3200/api/v1/memory";
// Per-user config via env vars — defaults to Thomas for backward compatibility
// Config template: set BRAIN_API_KEY, BRAIN_AGENT_ID, BRAIN_AGENT_NAME per user
const BRAIN_API_KEY = process.env.BRAIN_API_KEY || "default-thomas-key";
const BRAIN_AGENT_ID = process.env.BRAIN_AGENT_ID || "thomas";
const BRAIN_AGENT_NAME = process.env.BRAIN_AGENT_NAME || "Thomas Pichler";
const MCP_PORT = 3201;

async function callBrain(prompt: string, context?: string, session_id?: string, full_content?: boolean, read_only?: boolean): Promise<unknown> {
  const body: Record<string, unknown> = { prompt, agent_id: BRAIN_AGENT_ID, agent_name: BRAIN_AGENT_NAME };
  if (context) body.context = context;
  if (session_id) body.session_id = session_id;
  if (full_content) body.full_content = true;
  if (read_only) body.read_only = true;

  const res = await fetch(BRAIN_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${BRAIN_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Brain API error ${res.status}: ${err}`);
  }
  return res.json();
}

async function getThought(thought_id: string): Promise<unknown> {
  const res = await fetch(`${BRAIN_API}/thought/${thought_id}`, {
    headers: { "Authorization": `Bearer ${BRAIN_API_KEY}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Brain API error ${res.status}: ${err}`);
  }
  return res.json();
}

function createMcpServer(): McpServer {
  const mcp = new McpServer(
    { name: "xpollination-brain", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  mcp.tool(
    "query_brain",
    "Query the shared agent brain for knowledge on a topic. Returns matching thoughts with sources and high-traffic knowledge paths.",
    {
      prompt: z.string().describe("Natural language question or topic to search"),
      context: z.string().optional().describe("What you are currently working on — changes retrieval direction"),
      session_id: z.string().optional().describe("Reuse from previous call for conversation continuity"),
      include_full_content: z.boolean().optional().describe("When true, sources include full content instead of 80-char preview"),
      read_only: z.boolean().optional().describe("When true, query is not persisted as a thought — use for research sessions to avoid noise"),
    },
    async ({ prompt, context, session_id, include_full_content, read_only }) => {
      const data = await callBrain(prompt, context, session_id, include_full_content ?? undefined, read_only ?? undefined) as Record<string, unknown>;
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  mcp.tool(
    "contribute_to_brain",
    "Contribute a strategic thought or learning to the shared agent brain. Must be >50 chars and a declarative statement (not a question).",
    {
      prompt: z.string().min(51).describe("Declarative statement to store as knowledge (>50 chars, not a question)"),
      context: z.string().optional().describe("What you are currently working on — stored as provenance"),
      session_id: z.string().optional().describe("Reuse from previous call for conversation continuity"),
    },
    async ({ prompt, context, session_id }) => {
      const data = await callBrain(prompt, context, session_id) as Record<string, unknown>;
      const trace = data.trace as Record<string, unknown> | undefined;
      const contributed = trace?.thoughts_contributed ?? 0;
      const prefix = contributed > 0
        ? "Thought stored successfully."
        : "Not stored (too short or interrogative). Still retrieved related thoughts:";
      return { content: [{ type: "text" as const, text: `${prefix}\n\n${JSON.stringify(data, null, 2)}` }] };
    }
  );

  mcp.tool(
    "drill_down_thought",
    "Retrieve the full content of a specific thought by its ID. Use after query_brain to read complete thoughts beyond the 80-char preview.",
    {
      thought_id: z.string().describe("The thought_id to retrieve"),
    },
    async ({ thought_id }) => {
      try {
        const data = await getThought(thought_id);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
      }
    }
  );

  return mcp;
}

export async function startMcpServer(): Promise<void> {
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS for Claude.ai
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Stateless mode: new server+transport per request
    try {
      const mcp = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });

      await mcp.connect(transport);
      await transport.handleRequest(req, res);
      await mcp.close();
    } catch (err) {
      console.error("MCP request handler error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal MCP server error" }));
      }
    }
  });

  httpServer.on("error", (err) => {
    console.error("MCP HTTP server error:", err);
  });

  httpServer.listen(MCP_PORT, "0.0.0.0", () => {
    console.log(`MCP server (brain wrapper) running on http://0.0.0.0:${MCP_PORT}`);
  });
}
