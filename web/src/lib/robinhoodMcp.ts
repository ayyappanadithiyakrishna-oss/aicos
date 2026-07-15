/* Shared helper for driving the Robinhood MCP server through the Anthropic
   API (MCP connector). Every server route that needs Robinhood data — quotes,
   search, order review/placement, order status — runs through here so the
   server URL, beta header, model, and content-block parsing live in one place.

   Returns null when ANTHROPIC_API_KEY is absent so callers can fall back. */

import Anthropic from "@anthropic-ai/sdk";

export const ROBINHOOD_MCP_URL = "https://agent.robinhood.com/mcp/trading";
const MCP_BETA = "mcp-client-2025-04-04";
const MODEL = "claude-sonnet-4-6";

export interface McpToolResult {
  toolName: string;
  data: unknown; // JSON-parsed tool result, or the raw string if not JSON
  raw: string;
  isError: boolean;
}

export interface RobinhoodRun {
  results: McpToolResult[];
  text: string; // any assistant prose / final JSON outside tool results
}

export async function runRobinhoodTools(opts: {
  allowedTools: string[];
  prompt: string;
  maxTokens?: number;
}): Promise<RobinhoodRun | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 4096,
    betas: [MCP_BETA],
    mcp_servers: [
      {
        type: "url",
        name: "robinhood",
        url: ROBINHOOD_MCP_URL,
        authorization_token: process.env.ROBINHOOD_MCP_TOKEN ?? undefined,
        tool_configuration: { enabled: true, allowed_tools: opts.allowedTools },
      },
    ],
    messages: [{ role: "user", content: opts.prompt }],
  });

  // Map tool_use ids → tool names so results can be labelled.
  const toolNames = new Map<string, string>();
  for (const block of response.content) {
    if (block.type === "mcp_tool_use") toolNames.set(block.id, block.name);
  }

  const results: McpToolResult[] = [];
  let text = "";
  for (const block of response.content) {
    if (block.type === "text") {
      text += block.text;
    } else if (block.type === "mcp_tool_result") {
      const raw =
        typeof block.content === "string"
          ? block.content
          : block.content.map((c) => ("text" in c ? c.text : "")).join("");
      let data: unknown = raw;
      try {
        data = JSON.parse(raw);
      } catch {
        /* leave as raw string */
      }
      results.push({
        toolName: toolNames.get(block.tool_use_id) ?? "",
        data,
        raw,
        isError: block.is_error,
      });
    }
  }

  return { results, text };
}

/* Best-effort: pull the first JSON object/array out of a model text block,
   tolerating ```json fences. Used where we ask the model to emit JSON. */
export function parseJsonFromText<T = unknown>(text: string): T | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start === -1) return null;
  for (let end = body.length; end > start; end--) {
    const slice = body.slice(start, end);
    try {
      return JSON.parse(slice) as T;
    } catch {
      /* keep shrinking */
    }
  }
  return null;
}
