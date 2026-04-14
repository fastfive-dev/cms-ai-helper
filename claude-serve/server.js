import http from "node:http";
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { query } from "@anthropic-ai/claude-agent-sdk";

// ---------------------------------------------------------------------------
// Prevent uncaught errors from crashing the process
// ---------------------------------------------------------------------------
process.on("uncaughtException", (err) => {
  console.error(`[claude-serve] uncaughtException: ${err.message}`, err.stack);
});
process.on("unhandledRejection", (reason) => {
  console.error(`[claude-serve] unhandledRejection:`, reason);
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CLAUDE_SERVE_AUTH_TOKEN = process.env.CLAUDE_SERVE_AUTH_TOKEN || "";

const PORT = parseInt(process.env.CLAUDE_SERVE_PORT, 10) || 4097;

const config = (() => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, "config.json"), "utf8"),
    );
  } catch {
    return {};
  }
})();

const DEFAULT_MODEL = (config.model || "claude-opus-4-6").replace(
  /^anthropic\//,
  "",
);
const DEFAULT_EFFORT = config.effort || undefined;
const TIMEOUT_MS = config.timeout || 1200000;

// ---------------------------------------------------------------------------
// Load agents from ~/.claude/agents/*.md
// ---------------------------------------------------------------------------
const AGENTS = (() => {
  const agentsDir = path.join(os.homedir(), ".claude", "agents");
  const agents = {};
  try {
    const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(agentsDir, file), "utf8");
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!fmMatch) continue;

      const frontmatter = fmMatch[1];
      const prompt = fmMatch[2].trim();

      const get = (key) => {
        const m = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
        return m ? m[1].trim() : undefined;
      };

      const name = get("name") || file.replace(".md", "");
      const description = get("description") || name;
      const model = get("model");
      const disallowed = get("disallowedTools");

      agents[name] = { description, prompt };
      if (model) agents[name].model = model;
      if (disallowed) {
        agents[name].disallowedTools = disallowed
          .split(",")
          .map((t) => t.trim());
      }
    }
    console.log(
      `[claude-serve] Loaded ${Object.keys(agents).length} agents: ${Object.keys(agents).join(", ")}`,
    );
  } catch (err) {
    console.warn(`[claude-serve] Failed to load agents: ${err.message}`);
  }
  return agents;
})();

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------
const sessions = new Map();
const sseClients = new Set();

function makeId(prefix) {
  return prefix + "_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

function now() {
  return Date.now();
}

function broadcast(event) {
  const data = "data: " + JSON.stringify(event) + "\n\n";
  for (const res of sseClients) {
    try {
      res.write(data);
    } catch {
      sseClients.delete(res);
    }
  }
}

// ---------------------------------------------------------------------------
// Load extra MCP servers from ~/.claude/.mcp.json
// ---------------------------------------------------------------------------
function loadMcpJsonServers() {
  try {
    const mcpJsonPath = path.join(os.homedir(), ".claude", ".mcp.json");
    const raw = JSON.parse(fs.readFileSync(mcpJsonPath, "utf8"));
    const servers = raw.mcpServers || {};
    const loaded = {};
    for (const [name, cfg] of Object.entries(servers)) {
      if (cfg.url) {
        loaded[name] = { type: cfg.type || "http", url: cfg.url };
        console.log(
          `[claude-serve] MCP from .mcp.json: ${name} → ${cfg.url}`,
        );
      }
    }
    return loaded;
  } catch {
    return {};
  }
}

const EXTRA_MCP_SERVERS = loadMcpJsonServers();

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "10mb" }));

// Token-based auth middleware (dev bypass when CLAUDE_SERVE_AUTH_TOKEN not set)
function requireAuth(req, res, next) {
  if (!CLAUDE_SERVE_AUTH_TOKEN) return next();
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;
  if (token === CLAUDE_SERVE_AUTH_TOKEN) return next();
  return res
    .status(401)
    .json({ name: "Unauthorized", message: "Invalid or missing token" });
}

// GET /session — list sessions (health check, no auth required)
app.get("/session", (_req, res) => {
  const list = [];
  for (const s of sessions.values()) {
    list.push({ id: s.id, title: s.title || "", time: s.time });
  }
  res.json(list);
});

// POST /session — create session
app.post("/session", requireAuth, (_req, res) => {
  const id = makeId("ses");
  const session = {
    id,
    title: "",
    messages: [],
    time: { created: now(), updated: now() },
  };
  sessions.set(id, session);
  console.log(`[claude-serve] Session created: ${id}`);
  res.json(session);
});

// GET /session/:sessionID/message — list messages
app.get("/session/:sessionID/message", requireAuth, (req, res) => {
  const session = sessions.get(req.params.sessionID);
  if (!session)
    return res
      .status(404)
      .json({ name: "NotFound", message: "Session not found" });
  res.json(session.messages);
});

// POST /session/:sessionID/message — send message (runs Claude Agent SDK)
app.post("/session/:sessionID/message", requireAuth, async (req, res) => {
  const session = sessions.get(req.params.sessionID);
  if (!session)
    return res
      .status(404)
      .json({ name: "NotFound", message: "Session not found" });

  const body = req.body || {};
  const modelID = body.modelID || DEFAULT_MODEL;
  const maxTurns = body.maxTurns || undefined;
  const promptText = (body.parts || [])
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n");

  if (!promptText.trim()) {
    return res
      .status(400)
      .json({ name: "BadRequest", message: "Empty prompt" });
  }

  const directory =
    body.directory ||
    req.query.directory ||
    req.headers["x-directory"] ||
    process.cwd();
  const messageID = makeId("msg");
  const sessionID = session.id;

  // Store user message
  session.messages.push({
    info: {
      id: makeId("msg"),
      role: "user",
      sessionID,
      time: { created: now() },
    },
    parts: body.parts || [],
  });

  // Emit step-start SSE
  const stepStartPartId = makeId("part");
  broadcast({
    type: "message.part.updated",
    properties: {
      part: { id: stepStartPartId, sessionID, messageID, type: "step-start" },
    },
  });

  // --- SDK query ---
  const abortCtrl = new AbortController();
  session._abortCtrl = abortCtrl;

  // Abort SDK query if client disconnects mid-stream
  res.on("close", () => {
    if (!res.writableEnded && !abortCtrl.signal.aborted) {
      console.log(
        `[claude-serve] Client disconnected, aborting session ${sessionID}`,
      );
      abortCtrl.abort();
    }
  });

  // Build prompt as async iterable
  async function* promptStream() {
    yield {
      type: "user",
      message: { role: "user", content: promptText },
    };
  }

  const textPartId = makeId("part");
  let accumulatedText = "";
  const assistantParts = [];
  let claudeSessionId = session._claudeSessionId || null;
  const toolPartIds = new Map();

  // Set a timeout to abort the query
  const timer = setTimeout(() => abortCtrl.abort(), TIMEOUT_MS);

  try {
    // Auto-resume: use stored Claude session ID from previous query
    const resumeId =
      body.resumeSessionId || session._claudeSessionId || null;

    const queryOpts = {
      mcpServers:
        Object.keys(EXTRA_MCP_SERVERS).length > 0
          ? EXTRA_MCP_SERVERS
          : undefined,
      model: modelID,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_PATH || undefined,
      cwd: directory,
      includePartialMessages: true,
      abortController: abortCtrl,
      settingSources: ["user", "project"],
      systemPrompt: body.systemPrompt
        ? body.systemPrompt
        : { type: "preset", preset: "claude_code" },
      ...(body.disallowedTools ? { disallowedTools: body.disallowedTools } : {}),
      ...(body.thinking ? { thinking: body.thinking } : {}),
      ...(DEFAULT_EFFORT ? { extraArgs: { effort: DEFAULT_EFFORT } } : {}),
      ...(maxTurns ? { maxTurns } : {}),
      ...(Object.keys(AGENTS).length ? { agents: AGENTS } : {}),
    };

    if (resumeId) {
      queryOpts.resume = resumeId;
    }

    console.log(
      `[claude-serve] Running SDK query for session ${sessionID} (model: ${modelID}, cwd: ${directory}${resumeId ? `, resume: ${resumeId}` : ", new conversation"})`,
    );

    let msgCount = 0;
    for await (const msg of query({
      prompt: promptStream(),
      options: queryOpts,
    })) {
      msgCount++;

      // ---- System init message: capture session_id ----
      if (msg.type === "system" && msg.subtype === "init") {
        claudeSessionId = msg.session_id;
        console.log(
          `[claude-serve] Init: tools=${JSON.stringify(msg.tools)}, mcp_servers=${JSON.stringify(msg.mcp_servers)}`,
        );
        continue;
      }

      // ---- Streaming partial messages (text deltas) ----
      if (msg.type === "stream_event") {
        const evt = msg.event;

        // Text delta → accumulate + broadcast
        if (
          evt.type === "content_block_delta" &&
          evt.delta?.type === "text_delta"
        ) {
          accumulatedText += evt.delta.text;
          broadcast({
            type: "message.part.updated",
            properties: {
              part: {
                id: textPartId,
                sessionID,
                messageID,
                type: "text",
                text: accumulatedText,
              },
            },
          });
        }

        // Tool use start → emit "running" state
        if (
          evt.type === "content_block_start" &&
          evt.content_block?.type === "tool_use"
        ) {
          const block = evt.content_block;
          const toolPartId = makeId("part");
          toolPartIds.set(block.id, toolPartId);

          broadcast({
            type: "message.part.updated",
            properties: {
              part: {
                id: toolPartId,
                sessionID,
                messageID,
                type: "tool",
                tool: block.name || "unknown",
                state: {
                  status: "running",
                  input: {},
                  title: block.name || "",
                },
              },
            },
          });
        }

        continue;
      }

      // ---- Complete assistant message (tool_use blocks + final text) ----
      if (msg.type === "assistant") {
        for (const block of msg.message?.content || []) {
          if (block.type === "tool_use") {
            let toolPartId = toolPartIds.get(block.id);
            if (!toolPartId) {
              toolPartId = makeId("part");
              toolPartIds.set(block.id, toolPartId);
            }

            broadcast({
              type: "message.part.updated",
              properties: {
                part: {
                  id: toolPartId,
                  sessionID,
                  messageID,
                  type: "tool",
                  tool: block.name || "unknown",
                  state: {
                    status: "completed",
                    input: block.input || {},
                    title: block.name || "",
                  },
                },
              },
            });

            assistantParts.push({
              id: toolPartId,
              sessionID,
              messageID,
              type: "tool",
              tool: block.name || "unknown",
              state: { status: "completed", input: block.input || {} },
            });
          }

          if (block.type === "text" && block.text) {
            if (!accumulatedText) {
              accumulatedText = block.text;
              broadcast({
                type: "message.part.updated",
                properties: {
                  part: {
                    id: textPartId,
                    sessionID,
                    messageID,
                    type: "text",
                    text: accumulatedText,
                  },
                },
              });
            }
          }
        }
        continue;
      }

      // ---- Result message: query complete ----
      if (msg.type === "result") {
        claudeSessionId = msg.session_id;
        if (claudeSessionId) {
          session._claudeSessionId = claudeSessionId;
        }
        if (msg.subtype !== "success") {
          const errors = msg.errors || [];
          console.error(
            `[claude-serve] Query ended with ${msg.subtype}: ${errors.join(", ")}`,
          );
        }
        console.log(
          `[claude-serve] Query completed for session ${sessionID} ` +
            `(turns: ${msg.num_turns}, cost: $${msg.total_cost_usd?.toFixed(4)})`,
        );
        break;
      }
    }

    if (msgCount === 0) {
      console.error(
        `[claude-serve] Query returned 0 messages for session ${sessionID} (model: ${modelID}, cwd: ${directory})`,
      );
    } else if (!accumulatedText) {
      console.warn(
        `[claude-serve] Query produced no text output for session ${sessionID} (model: ${modelID}, msgs: ${msgCount}, parts: ${assistantParts.length})`,
      );
    }
  } catch (err) {
    if (err.name === "AbortError") {
      console.log(`[claude-serve] Query aborted for session ${sessionID}`);
    } else {
      console.error(
        `[claude-serve] Query error for session ${sessionID} (model: ${modelID}): ${err.message}`,
        err.stack,
      );
      broadcast({
        type: "session.error",
        properties: {
          sessionID,
          error: { name: err.message },
        },
      });
    }
  } finally {
    clearTimeout(timer);
    delete session._abortCtrl;
  }

  // ---- Emit step-finish ----
  broadcast({
    type: "message.part.updated",
    properties: {
      part: {
        id: makeId("part"),
        sessionID,
        messageID,
        type: "step-finish",
        reason: "stop",
      },
    },
  });

  // ---- Build assistant message for HTTP response ----
  if (accumulatedText) {
    assistantParts.unshift({
      id: textPartId,
      sessionID,
      messageID,
      type: "text",
      text: accumulatedText,
    });
  }

  const assistantMessage = {
    info: {
      id: messageID,
      sessionID,
      role: "assistant",
      time: { created: session.time.updated, completed: now() },
      ...(claudeSessionId ? { claudeSessionId } : {}),
    },
    parts: assistantParts,
  };
  session.messages.push(assistantMessage);
  session.time.updated = now();

  res.json(assistantMessage);
});

// GET /event — SSE event stream
app.get("/event", (req, res) => {
  if (CLAUDE_SERVE_AUTH_TOKEN) {
    const token = req.query.token || "";
    if (token !== CLAUDE_SERVE_AUTH_TOKEN) {
      return res
        .status(401)
        .json({ name: "Unauthorized", message: "Invalid or missing token" });
    }
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  });

  res.write(
    "data: " +
      JSON.stringify({ type: "server.connected", properties: {} }) +
      "\n\n",
  );
  sseClients.add(res);
  console.log(
    `[claude-serve] SSE client connected (total: ${sseClients.size})`,
  );

  const heartbeat = setInterval(() => {
    try {
      res.write(
        "data: " +
          JSON.stringify({ type: "server.heartbeat", properties: {} }) +
          "\n\n",
      );
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 10000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
    console.log(
      `[claude-serve] SSE client disconnected (total: ${sseClients.size})`,
    );
  });
});

// POST /session/:sessionID/abort — cancel running query
app.post("/session/:sessionID/abort", requireAuth, (req, res) => {
  const session = sessions.get(req.params.sessionID);
  if (session?._abortCtrl) {
    session._abortCtrl.abort();
    console.log(`[claude-serve] Aborted session ${req.params.sessionID}`);
  }
  res.json(true);
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const server = http.createServer(app);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[claude-serve] listening on http://0.0.0.0:${PORT}`);
  console.log(
    `[claude-serve] model=${DEFAULT_MODEL}, effort=${DEFAULT_EFFORT || "default"}, timeout=${TIMEOUT_MS}ms`,
  );
});
