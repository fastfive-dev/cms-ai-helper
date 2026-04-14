import http from "node:http";
import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {query} from "@anthropic-ai/claude-agent-sdk";
import * as db from "./db.js";

// ---------------------------------------------------------------------------
// Prevent uncaught errors from crashing the process
// ---------------------------------------------------------------------------
process.on("uncaughtException", (err) => {
    console.error(`[admin-helper] uncaughtException: ${err.message}`, err.stack);
});
process.on("unhandledRejection", (reason) => {
    console.error(`[admin-helper] unhandledRejection:`, reason);
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const PORT = parseInt(process.env.PORT, 10) || 4098;
const DEFAULT_MODEL = process.env.MODEL || "claude-sonnet-4-5-20250929";
const TIMEOUT_MS = parseInt(process.env.TIMEOUT, 10) || 300000; // 5분

// Knowledge base 로드
let knowledgeContent = "";
try {
    knowledgeContent = fs.readFileSync(
        path.join(__dirname, "knowledge.md"),
        "utf-8",
    );
} catch {
    console.warn("[admin-helper] knowledge.md not found, continuing without it");
}

// Admin Helper 시스템 프롬프트
const SYSTEM_PROMPT = `당신은 FASTFIVE CMS 프로덕트 사용 가이드입니다.
사용자의 질문이 무엇이든, CMS의 어떤 기능(메뉴, 화면, 필터, 데이터)을 활용하면 해결할 수 있는지 안내하는 것이 핵심 역할입니다.
사용자가 현재 보고 있는 CMS 화면 정보와 스크린샷이 함께 제공될 수 있습니다.

## 핵심 원칙
사용자가 업무 질문을 하면 (예: "강남1호점에 주차 가능해?"), 그 답을 직접 알려주는 것이 아니라 CMS에서 해당 정보를 확인할 수 있는 경로와 방법을 안내하세요.
즉, "답을 알려주는 도우미"가 아니라 "CMS로 답을 찾는 방법을 알려주는 가이드"입니다.

## 응답 구조 (이 순서를 반드시 지켜주세요)
1. **활용 예시를 가장 먼저** — 해당 화면에서 자주 쓰는 실무 시나리오를 "질문/목적 → 조작 순서" 형식으로 2~4개 제시
   형식: "OO 확인" → 필터/검색 조건 → 클릭 경로 → 결과 확인
2. 그 다음에 화면의 주요 기능을 설명

## 응답 가이드라인
- 사용자의 질문을 CMS 기능으로 연결하세요 — 어떤 메뉴에서, 어떤 필터/검색으로 원하는 정보를 찾을 수 있는지 구체적으로 안내
- 버튼, 필터, 탭 등 UI 요소를 언급할 때는 정확한 명칭을 사용하세요
- 단계별로 안내할 때는 번호를 매겨주세요
- 관련된 다른 메뉴나 기능이 있으면 함께 안내해주세요
- 한국어로 답변하세요

## 절대 설명하지 않을 자명한 UI 기능
아래 항목은 응답에 절대 포함하지 마세요. 사용자가 해당 기능을 명시적으로 질문한 경우에만 예외입니다.
절대 포함 금지:
- 페이지네이션 (◀/▶ 버튼, 페이지 번호, 페이지 이동)
- 한 페이지 행 수 설정 (Rows, 페이지 크기 드롭다운)
- 테이블 컬럼 정렬 (컬럼 헤더 클릭으로 정렬)
- 범용 버튼 (검색창, 새로고침, 닫기(×))
- 브라우저/OS 기본 기능 (스크롤, 뒤로가기 등)
- 목록 표시 설정 관련 모든 안내
위 항목이 응답에 포함되면 사용자 경험을 해칩니다. 해당 화면 고유의 업무 로직, 상태 전환, 데이터 흐름에만 집중하세요.
${knowledgeContent ? "\n## 상세 사용 가이드\n" + knowledgeContent : ""}`;

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------
const sessions = new Map(); // sessionId -> { id, claudeSessionId, abortCtrl, ... }
const sseClients = new Set();

function makeId(prefix) {
    return prefix + "_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
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

function buildContextText(pageContext) {
    if (!pageContext) return "";

    const parts = ["\n\n---\n[현재 화면 정보]"];
    if (pageContext.url) parts.push(`URL: ${pageContext.url}`);
    if (pageContext.path) parts.push(`경로: ${pageContext.path}`);
    if (pageContext.breadcrumbs?.length > 0)
        parts.push(`메뉴: ${pageContext.breadcrumbs.join(" > ")}`);
    if (pageContext.activeMenu?.length > 0)
        parts.push(`활성 메뉴: ${pageContext.activeMenu.join(", ")}`);

    if (pageContext.pageContent) {
        const c = pageContext.pageContent;
        if (c.headers?.length > 0)
            parts.push(`페이지 제목: ${c.headers.join(", ")}`);
        if (c.tableColumns?.length > 0)
            parts.push(`테이블 컬럼: ${c.tableColumns.join(", ")}`);
        if (c.formFields?.length > 0)
            parts.push(`폼 필드: ${c.formFields.join(", ")}`);
        if (c.tabs?.length > 0) parts.push(`탭: ${c.tabs.join(", ")}`);
        if (c.actions?.length > 0)
            parts.push(`버튼/액션: ${c.actions.join(", ")}`);
    }

    if (pageContext.errors?.length > 0)
        parts.push(`에러: ${pageContext.errors.join("; ")}`);

    return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();

app.use(
    cors({
        origin(origin, callback) {
            if (!origin || /^chrome-extension:\/\//.test(origin)) {
                return callback(null, true);
            }
            const allowed = [
                "https://cms-dev.slowfive.com",
                "https://cms-staging.slowfive.com",
                "https://cms.slowfive.com"
            ];
            if (allowed.includes(origin)) return callback(null, true);
            callback(new Error("Not allowed by CORS"));
        },
        methods: ["POST", "GET"],
    }),
);

app.use(express.json({limit: "5mb"}));

// ---------------------------------------------------------------------------
// POST /session — create session
// ---------------------------------------------------------------------------
app.post("/session", (_req, res) => {
    const id = makeId("ses");
    const session = {
        id,
        claudeSessionId: null,
        messages: [],
        createdAt: Date.now(),
    };
    sessions.set(id, session);

    // DB에도 저장
    db.createSession(id, null, null);

    console.log(`[admin-helper] Session created: ${id}`);
    res.json({sessionId: id});
});

// ---------------------------------------------------------------------------
// POST /session/:id/message — send message (runs Claude Agent SDK)
// ---------------------------------------------------------------------------
app.post("/session/:sessionID/message", async (req, res) => {
    let session = sessions.get(req.params.sessionID);
    if (!session) {
        // 메모리에 없으면 새로 생성 (서버 재시작 대응)
        const id = req.params.sessionID;
        session = {
            id,
            claudeSessionId: null,
            messages: [],
            createdAt: Date.now(),
        };
        sessions.set(id, session);
        // DB에도 세션 row가 없으면 생성 (FK 제약 대응)
        if (!db.getSession(id)) {
            db.createSession(id, null, null);
        }
    }

    const body = req.body || {};
    const parts = body.parts || [];
    const pageContext = body.pageContext || null;

    const promptText = parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n");

    if (!promptText.trim()) {
        return res.status(400).json({error: "Empty prompt"});
    }

    // 페이지 컨텍스트를 프롬프트에 추가
    const fullPrompt = promptText + buildContextText(pageContext);

    // DB에 사용자 메시지 저장
    db.saveMessage(session.id, "user", promptText, pageContext, false);

    // --- SDK query ---
    const abortCtrl = new AbortController();
    session.abortCtrl = abortCtrl;

    res.on("close", () => {
        if (!res.writableEnded && !abortCtrl.signal.aborted) {
            abortCtrl.abort();
        }
    });

    async function* promptStream() {
        yield {
            type: "user",
            message: {role: "user", content: fullPrompt},
        };
    }

    const messageID = makeId("msg");
    let accumulatedText = "";
    let thinkingText = "";
    const thinkingPartId = makeId("part");
    const timer = setTimeout(() => abortCtrl.abort(), TIMEOUT_MS);

    // SSE: step-start
    broadcast({
        type: "message.part.updated",
        properties: {
            part: {
                id: makeId("part"),
                sessionID: session.id,
                messageID,
                type: "step-start",
            },
        },
    });

    try {
        const queryOpts = {
            model: DEFAULT_MODEL,
            permissionMode: "bypassPermissions",
            allowDangerouslySkipPermissions: true,
            abortController: abortCtrl,
            maxTurns: 1,
            systemPrompt: SYSTEM_PROMPT,
            disallowedTools: [
                "Bash",
                "Write",
                "Edit",
                "NotebookEdit",
                "TodoWrite",
            ],
            thinking: {type: "enabled", budgetTokens: 10000},
            includePartialMessages: true,
        };

        // 이전 Claude 세션이 있으면 resume
        if (session.claudeSessionId) {
            queryOpts.resume = session.claudeSessionId;
        }

        const textPartId = makeId("part");

        for await (const msg of query({
            prompt: promptStream(),
            options: queryOpts,
        })) {
            // Init: capture session_id
            if (msg.type === "system" && msg.subtype === "init") {
                session.claudeSessionId = msg.session_id;
                continue;
            }

            // Streaming deltas
            if (msg.type === "stream_event") {
                const evt = msg.event;

                // Thinking deltas
                if (
                    evt.type === "content_block_delta" &&
                    evt.delta?.type === "thinking_delta"
                ) {
                    thinkingText += evt.delta.thinking;
                    broadcast({
                        type: "message.part.updated",
                        properties: {
                            part: {
                                id: thinkingPartId,
                                sessionID: session.id,
                                messageID,
                                type: "thinking",
                                text: thinkingText,
                            },
                        },
                    });
                }

                // Text deltas
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
                                sessionID: session.id,
                                messageID,
                                type: "text",
                                text: accumulatedText,
                            },
                        },
                    });
                }
                continue;
            }

            // Complete assistant message
            if (msg.type === "assistant") {
                for (const block of msg.message?.content || []) {
                    if (block.type === "text" && block.text && !accumulatedText) {
                        accumulatedText = block.text;
                    }
                }
                continue;
            }

            // Result
            if (msg.type === "result") {
                session.claudeSessionId = msg.session_id || session.claudeSessionId;
                console.log(
                    `[admin-helper] Query completed (turns: ${msg.num_turns}, cost: $${msg.total_cost_usd?.toFixed(4)})`,
                );
                break;
            }
        }
    } catch (err) {
        if (err.name === "AbortError") {
            console.log(`[admin-helper] Query aborted for session ${session.id}`);
        } else {
            console.error(`[admin-helper] Query error: ${err.message}`);
        }
    } finally {
        clearTimeout(timer);
        delete session.abortCtrl;
    }

    // SSE: step-finish
    broadcast({
        type: "message.part.updated",
        properties: {
            part: {
                id: makeId("part"),
                sessionID: session.id,
                messageID,
                type: "step-finish",
                reason: "stop",
            },
        },
    });

    // DB에 어시스턴트 응답 저장
    if (accumulatedText) {
        db.saveMessage(session.id, "assistant", accumulatedText, null, false);
    }

    // HTTP 응답
    res.json({
        text: accumulatedText,
        thinking: thinkingText || null,
        sessionId: session.id,
        parts: accumulatedText
            ? [{type: "text", text: accumulatedText}]
            : [],
    });
});

// ---------------------------------------------------------------------------
// GET /event — SSE event stream
// ---------------------------------------------------------------------------
app.get("/event", (req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    });

    res.write(
        "data: " +
        JSON.stringify({type: "server.connected", properties: {}}) +
        "\n\n",
    );
    sseClients.add(res);

    const heartbeat = setInterval(() => {
        try {
            res.write(
                "data: " +
                JSON.stringify({type: "server.heartbeat", properties: {}}) +
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
    });
});

// ---------------------------------------------------------------------------
// POST /session/:id/abort — cancel running query
// ---------------------------------------------------------------------------
app.post("/session/:sessionID/abort", (req, res) => {
    const session = sessions.get(req.params.sessionID);
    if (session?.abortCtrl) {
        session.abortCtrl.abort();
    }
    res.json(true);
});

// ---------------------------------------------------------------------------
// 대화 이력 API
// ---------------------------------------------------------------------------
app.get("/api/sessions", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    res.json(db.listSessions(limit, offset));
});

app.get("/api/sessions/:sessionId/messages", (req, res) => {
    const session = db.getSession(req.params.sessionId);
    if (!session) {
        return res.status(404).json({error: "세션을 찾을 수 없습니다."});
    }
    res.json({session, messages: db.getMessages(req.params.sessionId)});
});

// Health check
app.get("/health", (_req, res) => {
    res.json({status: "ok", model: DEFAULT_MODEL});
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const server = http.createServer(app);
server.listen(PORT, () => {
    console.log(`[admin-helper] listening on http://localhost:${PORT}`);
    console.log(`[admin-helper] model=${DEFAULT_MODEL}, timeout=${TIMEOUT_MS}ms`);
});
