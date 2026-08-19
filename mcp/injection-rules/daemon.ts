#!/usr/bin/env bun
// daemon-sdk.ts — official @modelcontextprotocol/sdk stdio wrapper
// Port of daemon.ts using Server + StdioServerTransport
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { evaluate, listRules, getRule, status as rulesStatus } from "./core.mjs";

const server = new Server(
  { name: "injection-rules", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "evaluate",
      description: "Push text to per-session buffer and (if tick=true) compute rule applies.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          source: { type: "string", enum: ["user", "assistant", "tool"] },
          text: { type: "string" },
          tick: { type: "boolean" },
        },
        required: ["sessionId", "source"],
      },
    },
    {
      name: "list_rules",
      description: "List all active rules.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_rule",
      description: "Get a single rule by name.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
    {
      name: "status",
      description:
        "Daemon health: rules count, sessions count, uptime, char budget, state TTL. " +
        "With sessionId also returns that session's turn index and last budget overflow.",
      inputSchema: {
        type: "object",
        properties: { sessionId: { type: "string" } },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "evaluate") {
      const { sessionId, source, text, tick } = args ?? {};
      if (!sessionId || !source) {
        return { content: [{ type: "text", text: "sessionId and source required" }], isError: true };
      }
      const r = evaluate({ sessionId, source, text: text ?? "", tick: !!tick });
      return { content: [{ type: "text", text: JSON.stringify(r) }] };
    }
    if (name === "list_rules") {
      return { content: [{ type: "text", text: JSON.stringify({ rules: listRules() }) }] };
    }
    if (name === "get_rule") {
      const r = getRule(args?.name);
      if (!r) return { content: [{ type: "text", text: "rule not found" }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(r) }] };
    }
    if (name === "status") {
      return { content: [{ type: "text", text: JSON.stringify(rulesStatus(args?.sessionId)) }] };
    }
    return { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true };
  } catch (e: any) {
    return { content: [{ type: "text", text: `error: ${e.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
