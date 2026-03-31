#!/usr/bin/env node

// MCP Server for Unblocked Chrome extension.
// Started by Claude Code via stdio MCP transport.
// Also runs a TCP server for the native messaging host to connect.
// Bridges MCP tool calls to the Chrome extension and returns results.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";

const DEFAULT_PORT = 18765;

function getPort() {
  const configPath = path.join(os.homedir(), ".config", "unblocked-chrome", "config.json");
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return config.port || DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

// --- TCP bridge to native host ---

let nativeHostSocket = null;
const pendingRequests = new Map(); // id -> { resolve, reject, timer }
let requestIdCounter = 0;

function sendToExtension(tool, args) {
  return new Promise((resolve, reject) => {
    if (!nativeHostSocket || nativeHostSocket.destroyed) {
      reject(new Error("Browser extension is not connected. Make sure Chrome is running with the Unblocked Chrome extension installed and enabled."));
      return;
    }
    const id = String(++requestIdCounter);
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error("Tool request timed out after 60s"));
    }, 60000);
    pendingRequests.set(id, { resolve, reject, timer });
    const msg = JSON.stringify({ id, type: "tool_request", tool, args }) + "\n";
    nativeHostSocket.write(msg);
  });
}

const TCP_PORT = getPort();

// Write a pidfile so we can detect stale servers
const pidfilePath = path.join(os.tmpdir(), `unblocked-chrome-mcp-${TCP_PORT}.pid`);

async function killStaleServer() {
  try {
    const oldPid = parseInt(fs.readFileSync(pidfilePath, "utf-8").trim(), 10);
    if (oldPid && oldPid !== process.pid) {
      try {
        process.kill(oldPid, 0); // Check if alive
        process.kill(oldPid, "SIGTERM"); // Kill it
        // Wait a moment for it to release the port
        await new Promise((r) => setTimeout(r, 500));
      } catch {
        // Process already dead — fine
      }
    }
  } catch {
    // No pidfile — fine
  }
}

function writePidfile() {
  try {
    fs.writeFileSync(pidfilePath, String(process.pid));
  } catch {
    // Non-fatal
  }
}

function cleanupPidfile() {
  try {
    const content = fs.readFileSync(pidfilePath, "utf-8").trim();
    if (content === String(process.pid)) fs.unlinkSync(pidfilePath);
  } catch {
    // Non-fatal
  }
}

function shutdown() {
  cleanupPidfile();
  if (nativeHostSocket && !nativeHostSocket.destroyed) nativeHostSocket.destroy();
  for (const [id, { reject, timer }] of pendingRequests) {
    clearTimeout(timer);
    reject(new Error("Server shutting down"));
  }
  pendingRequests.clear();
  tcpServer.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGHUP", shutdown);
// When parent process (Claude Code) dies, stdin closes
process.stdin.on("end", shutdown);
process.stdin.resume(); // Ensure 'end' fires even though StdioServerTransport also reads

const tcpServer = net.createServer((socket) => {
  // Only allow one native host connection at a time
  if (nativeHostSocket && !nativeHostSocket.destroyed) {
    nativeHostSocket.destroy();
  }
  nativeHostSocket = socket;
  let buffer = Buffer.alloc(0);

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    let newlineIdx;
    while ((newlineIdx = buffer.indexOf(10)) !== -1) {
      const line = buffer.subarray(0, newlineIdx).toString("utf-8").trim();
      buffer = buffer.subarray(newlineIdx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === "heartbeat") continue; // Ignore heartbeats
        if (msg.id && pendingRequests.has(msg.id)) {
          const { resolve, reject, timer } = pendingRequests.get(msg.id);
          clearTimeout(timer);
          pendingRequests.delete(msg.id);
          if (msg.type === "tool_error") {
            reject(new Error(msg.error || "Tool execution failed"));
          } else {
            resolve(msg.result);
          }
        }
      } catch {
        // skip malformed
      }
    }
  });

  socket.on("error", () => {
    nativeHostSocket = null;
  });

  socket.on("close", () => {
    if (nativeHostSocket === socket) nativeHostSocket = null;
    // Reject all pending requests
    for (const [id, { reject, timer }] of pendingRequests) {
      clearTimeout(timer);
      reject(new Error("Native host disconnected"));
    }
    pendingRequests.clear();
  });
});

// Kill any stale server, then bind
await killStaleServer();

tcpServer.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    process.stderr.write(`Port ${TCP_PORT} still in use after killing stale server. Retrying...\n`);
    setTimeout(() => {
      tcpServer.close();
      tcpServer.listen(TCP_PORT, "127.0.0.1");
    }, 1000);
  }
});

tcpServer.listen(TCP_PORT, "127.0.0.1", () => {
  writePidfile();
});

// --- Helper to wrap tool results for MCP ---

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

function imageResult(base64, mimeType = "image/png") {
  return { content: [{ type: "image", data: base64, mimeType }] };
}

function mixedResult(parts) {
  return { content: parts };
}

async function callTool(toolName, args) {
  try {
    const result = await sendToExtension(toolName, args);
    // Result from extension can be a string, object with content array, or raw data
    if (typeof result === "string") return textResult(result);
    if (result && result.content) return result;
    return textResult(JSON.stringify(result, null, 2));
  } catch (err) {
    return textResult(`Error: ${err.message}`);
  }
}

// --- MCP Server with all 18 tools ---

const server = new McpServer({
  name: "unblocked-chrome",
  version: "1.0.0",
});

// 1. tabs_context_mcp
server.tool(
  "tabs_context_mcp",
  "Get context information about the current MCP tab group. Returns all tab IDs inside the group if it exists. CRITICAL: You must get the context at least once before using other browser automation tools so you know what tabs exist. Each new conversation should create its own new tab (using tabs_create_mcp) rather than reusing existing tabs, unless the user explicitly asks to use an existing tab.",
  { createIfEmpty: z.boolean().optional().describe("Creates a new MCP tab group if none exists, creates a new Window with a new tab group containing an empty tab (which can be used for this conversation). If a MCP tab group already exists, this parameter has no effect.") },
  async (args) => callTool("tabs_context_mcp", args)
);

// 2. tabs_create_mcp
server.tool(
  "tabs_create_mcp",
  "Creates a new empty tab in the MCP tab group. CRITICAL: You must get the context using tabs_context_mcp at least once before using other browser automation tools so you know what tabs exist.",
  {},
  async (args) => callTool("tabs_create_mcp", args)
);

// 3. navigate
server.tool(
  "navigate",
  'Navigate to a URL, or go forward/back in browser history. If you don\'t have a valid tab ID, use tabs_context_mcp first to get available tabs.',
  {
    url: z.string().describe('The URL to navigate to. Can be provided with or without protocol (defaults to https://). Use "forward" to go forward in history or "back" to go back in history.'),
    tabId: z.number().describe("Tab ID to navigate. Must be a tab in the current group. Use tabs_context_mcp first if you don't have a valid tab ID."),
  },
  async (args) => callTool("navigate", args)
);

// 4. computer
server.tool(
  "computer",
  "Use a mouse and keyboard to interact with a web browser, and take screenshots. Whenever you intend to click on an element like an icon, you should consult a screenshot to determine the coordinates of the element before moving the cursor.",
  {
    action: z.enum([
      "left_click", "right_click", "double_click", "triple_click",
      "type", "screenshot", "wait", "scroll", "key",
      "left_click_drag", "zoom", "scroll_to", "hover"
    ]).describe("The action to perform."),
    tabId: z.number().describe("Tab ID to execute the action on."),
    coordinate: z.array(z.number()).optional().describe("The x (pixels from left edge) and y (pixels from top edge) coordinates. Required for most click actions and scroll."),
    duration: z.number().optional().describe("The number of seconds to wait (for wait action). Maximum 30 seconds."),
    modifiers: z.string().optional().describe('Modifier keys for click actions. Supports: "ctrl", "shift", "alt", "cmd" (or "meta"), "win" (or "windows"). Can be combined with "+".'),
    ref: z.string().optional().describe('Element reference ID from read_page or find tools (e.g., "ref_1"). Can be used as alternative to coordinate for click/scroll_to actions.'),
    region: z.array(z.number()).optional().describe("The rectangular region to capture for zoom action [x0, y0, x1, y1]."),
    repeat: z.number().optional().describe("Number of times to repeat the key sequence (for key action). 1-100, default 1."),
    scroll_direction: z.enum(["up", "down", "left", "right"]).optional().describe("Direction to scroll (required for scroll action)."),
    scroll_amount: z.number().optional().describe("The number of scroll wheel ticks. 1-10, defaults to 3."),
    start_coordinate: z.array(z.number()).optional().describe("Starting coordinates for left_click_drag."),
    text: z.string().optional().describe('The text to type (for type action) or key(s) to press (for key action).'),
  },
  async (args) => callTool("computer", args)
);

// 5. find
server.tool(
  "find",
  'Find elements on the page using natural language. Can search for elements by their purpose (e.g., "search bar", "login button") or by text content. Returns up to 20 matching elements with references that can be used with other tools.',
  {
    query: z.string().describe('Natural language description of what to find (e.g., "search bar", "add to cart button", "product title containing organic")'),
    tabId: z.number().describe("Tab ID to search in. Must be a tab in the current group."),
  },
  async (args) => callTool("find", args)
);

// 6. form_input
server.tool(
  "form_input",
  "Set values in form elements using element reference ID from the read_page tool.",
  {
    ref: z.string().describe('Element reference ID from the read_page tool (e.g., "ref_1", "ref_2")'),
    value: z.union([z.string(), z.boolean(), z.number()]).describe("The value to set. For checkboxes use boolean, for selects use option value or text, for other inputs use appropriate string/number."),
    tabId: z.number().describe("Tab ID to set form value in. Must be a tab in the current group."),
  },
  async (args) => callTool("form_input", args)
);

// 7. get_page_text
server.tool(
  "get_page_text",
  "Extract raw text content from the page, prioritizing article content. Ideal for reading articles, blog posts, or other text-heavy pages. Returns plain text without HTML formatting.",
  {
    tabId: z.number().describe("Tab ID to extract text from. Must be a tab in the current group."),
  },
  async (args) => callTool("get_page_text", args)
);

// 8. gif_creator
server.tool(
  "gif_creator",
  "Manage GIF recording and export for browser automation sessions. Control when to start/stop recording browser actions (clicks, scrolls, navigation), then export as an animated GIF with visual overlays.",
  {
    action: z.enum(["start_recording", "stop_recording", "export", "clear"]).describe("Action to perform."),
    tabId: z.number().describe("Tab ID to identify which tab group this operation applies to."),
    download: z.boolean().optional().describe("Set to true for the export action to download the GIF in the browser."),
    filename: z.string().optional().describe("Optional filename for exported GIF (default: 'recording-[timestamp].gif'). For export action only."),
    options: z.object({
      showClickIndicators: z.boolean().optional(),
      showDragPaths: z.boolean().optional(),
      showActionLabels: z.boolean().optional(),
      showProgressBar: z.boolean().optional(),
      showWatermark: z.boolean().optional(),
      quality: z.number().optional(),
    }).optional().describe("Optional GIF enhancement options for export action."),
  },
  async (args) => callTool("gif_creator", args)
);

// 9. javascript_tool
server.tool(
  "javascript_tool",
  "Execute JavaScript code in the context of the current page. The code runs in the page's context and can interact with the DOM, window object, and page variables. Returns the result of the last expression or any thrown errors.",
  {
    action: z.literal("javascript_exec").describe("Must be set to 'javascript_exec'"),
    text: z.string().describe("The JavaScript code to execute. Do NOT use 'return' statements - just write the expression you want to evaluate."),
    tabId: z.number().describe("Tab ID to execute the code in. Must be a tab in the current group."),
  },
  async (args) => callTool("javascript_tool", args)
);

// 10. read_console_messages
server.tool(
  "read_console_messages",
  "Read browser console messages (console.log, console.error, console.warn, etc.) from a specific tab. Useful for debugging JavaScript errors, viewing application logs, or understanding what's happening in the browser console. Returns console messages from the current domain only.",
  {
    tabId: z.number().describe("Tab ID to read console messages from. Must be a tab in the current group."),
    pattern: z.string().describe("Regex pattern to filter console messages (e.g., 'error|warning' to find errors and warnings). IMPORTANT: Always provide a pattern to avoid getting too many irrelevant messages."),
    limit: z.number().optional().describe("Maximum number of messages to return. Defaults to 100."),
    onlyErrors: z.boolean().optional().describe("If true, only return error and exception messages. Default is false."),
    clear: z.boolean().optional().describe("If true, clear the console messages after reading. Default is false."),
  },
  async (args) => callTool("read_console_messages", args)
);

// 11. read_network_requests
server.tool(
  "read_network_requests",
  "Read HTTP network requests (XHR, Fetch, documents, images, etc.) from a specific tab. Useful for debugging API calls, monitoring network activity, or understanding what requests a page is making.",
  {
    tabId: z.number().describe("Tab ID to read network requests from. Must be a tab in the current group."),
    urlPattern: z.string().optional().describe("Optional URL pattern to filter requests. Only requests whose URL contains this string will be returned."),
    limit: z.number().optional().describe("Maximum number of requests to return. Defaults to 100."),
    clear: z.boolean().optional().describe("If true, clear the network requests after reading. Default is false."),
  },
  async (args) => callTool("read_network_requests", args)
);

// 12. read_page
server.tool(
  "read_page",
  "Get an accessibility tree representation of elements on the page. By default returns all elements including non-visible ones. Output is limited to 50000 characters by default.",
  {
    tabId: z.number().describe("Tab ID to read from. Must be a tab in the current group."),
    filter: z.enum(["interactive", "all"]).optional().describe("Filter elements: 'interactive' for buttons/links/inputs only, 'all' for all elements (default: all elements)"),
    depth: z.number().optional().describe("Maximum depth of the tree to traverse (default: 15). Use a smaller depth if output is too large."),
    ref_id: z.string().optional().describe("Reference ID of a parent element to read. Will return the specified element and all its children."),
    max_chars: z.number().optional().describe("Maximum characters for output (default: 50000)."),
  },
  async (args) => callTool("read_page", args)
);

// 13. resize_window
server.tool(
  "resize_window",
  "Resize the current browser window to specified dimensions. Useful for testing responsive designs or setting up specific screen sizes.",
  {
    width: z.number().describe("Target window width in pixels"),
    height: z.number().describe("Target window height in pixels"),
    tabId: z.number().describe("Tab ID to get the window for. Must be a tab in the current group."),
  },
  async (args) => callTool("resize_window", args)
);

// 14. shortcuts_list
server.tool(
  "shortcuts_list",
  "List all available shortcuts and workflows. Returns shortcuts with their commands, descriptions, and whether they are workflows.",
  {
    tabId: z.number().describe("Tab ID to list shortcuts from. Must be a tab in the current group."),
  },
  async (args) => callTool("shortcuts_list", args)
);

// 15. shortcuts_execute
server.tool(
  "shortcuts_execute",
  "Execute a shortcut or workflow by running it in a new sidepanel window using the current tab.",
  {
    tabId: z.number().describe("Tab ID to execute the shortcut on. Must be a tab in the current group."),
    shortcutId: z.string().optional().describe("The ID of the shortcut to execute"),
    command: z.string().optional().describe("The command name of the shortcut to execute. Do not include the leading slash."),
  },
  async (args) => callTool("shortcuts_execute", args)
);

// 16. switch_browser
server.tool(
  "switch_browser",
  "Switch which Chrome browser is used for browser automation. Call this when the user wants to connect to a different Chrome browser.",
  {},
  async (args) => callTool("switch_browser", args)
);

// 17. update_plan
server.tool(
  "update_plan",
  "Present a plan to the user for approval before taking actions. The user will see the domains you intend to visit and your approach.",
  {
    domains: z.array(z.string()).describe("List of domains you will visit (e.g., ['github.com', 'stackoverflow.com'])"),
    approach: z.array(z.string()).describe("High-level description of what you will do. 3-7 items focusing on outcomes and key actions."),
  },
  async (args) => callTool("update_plan", args)
);

// 18. upload_image
server.tool(
  "upload_image",
  "Upload a previously captured screenshot or user-uploaded image to a file input or drag & drop target.",
  {
    imageId: z.string().describe("ID of a previously captured screenshot or a user-uploaded image"),
    tabId: z.number().describe("Tab ID where the target element is located."),
    ref: z.string().optional().describe("Element reference ID from read_page or find tools. Use this for file inputs or specific elements."),
    coordinate: z.array(z.number()).optional().describe("Viewport coordinates for drag & drop to a visible location."),
    filename: z.string().optional().describe('Optional filename for the uploaded file (default: "image.png")'),
  },
  async (args) => callTool("upload_image", args)
);

// --- Start MCP server ---

const transport = new StdioServerTransport();
await server.connect(transport);
