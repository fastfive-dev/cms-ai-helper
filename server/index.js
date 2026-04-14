import http from "node:http";
import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as db from "./db.js";
import { getPolicyContent, warmCache, isPolicyConfigured } from "./policy-loader.js";

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
const DEFAULT_MODEL = process.env.MODEL || "claude-opus-4-6";
const TIMEOUT_MS = parseInt(process.env.TIMEOUT, 10) || 300000; // 5분
const CLAUDE_SERVE_URL = process.env.CLAUDE_SERVE_URL || "http://localhost:4097";
const CLAUDE_SERVE_AUTH = process.env.CLAUDE_SERVE_AUTH_TOKEN || "";

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

// Admin Helper 시스템 프롬프트 (정책서 포함 시 동적 생성)
const SYSTEM_PROMPT_BASE = `당신은 FASTFIVE CMS 프로덕트 사용 가이드입니다.
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
- 서비스 정책서가 제공된 경우, 정책 내용을 바탕으로 더 정확한 답변을 하세요. 단, 정책 원문을 그대로 복사하지 말고 사용자의 질문 맥락에 맞게 요약·안내하세요.
- 정책서를 참고하여 답변한 경우, 응답 맨 하단에 출처를 표기하세요. 정책서 각 섹션의 <!-- source: URL --> 주석에서 URL을 추출하여 아래 형식으로 작성:
  📎 출처: [페이지 제목](URL)
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

function buildSystemPrompt(policyContent) {
    if (!policyContent) return SYSTEM_PROMPT_BASE;
    return (
        SYSTEM_PROMPT_BASE +
        "\n\n## 서비스 정책서 (FASTFIVE 멤버서비스)\n" +
        "아래는 Confluence에서 가져온 최신 서비스 정책서입니다. " +
        "사용자 질문에 답변할 때 이 정책 내용을 참고하여 정확한 정보를 제공하세요.\n\n" +
        policyContent
    );
}

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------
const sessions = new Map(); // sessionId -> { id, claudeServeSessionId, ... }
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
// claude-serve HTTP client helpers
// ---------------------------------------------------------------------------
function claudeServeHeaders() {
    const headers = {"Content-Type": "application/json"};
    if (CLAUDE_SERVE_AUTH) {
        headers["Authorization"] = `Bearer ${CLAUDE_SERVE_AUTH}`;
    }
    return headers;
}

async function createClaudeServeSession() {
    const resp = await fetch(`${CLAUDE_SERVE_URL}/session`, {
        method: "POST",
        headers: claudeServeHeaders(),
    });
    if (!resp.ok) throw new Error(`claude-serve session create failed: ${resp.status}`);
    return resp.json();
}

async function sendToClaudeServe(claudeServeSessionId, promptText, systemPrompt, signal) {
    return fetch(`${CLAUDE_SERVE_URL}/session/${claudeServeSessionId}/message`, {
        method: "POST",
        headers: claudeServeHeaders(),
        signal,
        body: JSON.stringify({
            modelID: DEFAULT_MODEL,
            maxTurns: 1,
            systemPrompt,
            disallowedTools: ["Bash", "Write", "Edit", "NotebookEdit", "TodoWrite"],
            thinking: {type: "enabled", budgetTokens: 5000},
            parts: [{type: "text", text: promptText}],
        }),
    });
}

async function abortClaudeServeSession(claudeServeSessionId) {
    try {
        await fetch(`${CLAUDE_SERVE_URL}/session/${claudeServeSessionId}/abort`, {
            method: "POST",
            headers: claudeServeHeaders(),
        });
    } catch {
        // ignore
    }
}

// ---------------------------------------------------------------------------
// SSE proxy: claude-serve → 자체 SSE 클라이언트로 전달
// ---------------------------------------------------------------------------
let sseUpstream = null;

function connectClaudeServeSSE() {
    const url = CLAUDE_SERVE_AUTH
        ? `${CLAUDE_SERVE_URL}/event?token=${CLAUDE_SERVE_AUTH}`
        : `${CLAUDE_SERVE_URL}/event`;

    console.log(`[admin-helper] Connecting to claude-serve SSE: ${CLAUDE_SERVE_URL}/event`);

    fetch(url).then(async (resp) => {
        if (!resp.ok) {
            console.error(`[admin-helper] claude-serve SSE connection failed: ${resp.status}`);
            setTimeout(connectClaudeServeSSE, 5000);
            return;
        }

        sseUpstream = resp;
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
            while (true) {
                const {done, value} = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, {stream: true});
                const lines = buffer.split("\n");
                buffer = lines.pop();

                for (const line of lines) {
                    if (!line.startsWith("data: ")) continue;
                    try {
                        const event = JSON.parse(line.slice(6));
                        if (event.type === "server.heartbeat" || event.type === "server.connected") continue;
                        broadcast(event);
                    } catch {
                        // skip malformed events
                    }
                }
            }
        } catch (err) {
            console.error(`[admin-helper] claude-serve SSE read error: ${err.message}`);
        }

        // 연결 끊기면 재연결
        console.log("[admin-helper] claude-serve SSE disconnected, reconnecting...");
        setTimeout(connectClaudeServeSSE, 3000);
    }).catch((err) => {
        console.error(`[admin-helper] claude-serve SSE connect error: ${err.message}`);
        setTimeout(connectClaudeServeSSE, 5000);
    });
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
app.post("/session", async (_req, res) => {
    try {
        const claudeServeSession = await createClaudeServeSession();

        const id = makeId("ses");
        const session = {
            id,
            claudeServeSessionId: claudeServeSession.id,
            createdAt: Date.now(),
        };
        sessions.set(id, session);
        db.createSession(id, null, null);

        console.log(`[admin-helper] Session created: ${id} → claude-serve: ${claudeServeSession.id}`);
        res.json({sessionId: id});
    } catch (err) {
        console.error(`[admin-helper] Session create error: ${err.message}`);
        res.status(502).json({error: "claude-serve 연결 실패"});
    }
});

// ---------------------------------------------------------------------------
// POST /session/:id/message — send message via claude-serve
// ---------------------------------------------------------------------------
app.post("/session/:sessionID/message", async (req, res) => {
    let session = sessions.get(req.params.sessionID);
    if (!session) {
        const id = req.params.sessionID;
        try {
            const claudeServeSession = await createClaudeServeSession();
            session = {
                id,
                claudeServeSessionId: claudeServeSession.id,
                createdAt: Date.now(),
            };
            sessions.set(id, session);
            if (!db.getSession(id)) {
                db.createSession(id, null, null);
            }
        } catch (err) {
            console.error(`[admin-helper] Session create error: ${err.message}`);
            return res.status(502).json({error: "claude-serve 연결 실패"});
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

    const fullPrompt = promptText + buildContextText(pageContext);

    // DB에 사용자 메시지 저장
    db.saveMessage(session.id, "user", promptText, pageContext, false);

    // 정책서 로드 (캐시된 경우 즉시 반환)
    const policyContent = await getPolicyContent();
    const systemPrompt = buildSystemPrompt(policyContent);

    // --- claude-serve로 요청 ---
    const abortCtrl = new AbortController();
    session.abortCtrl = abortCtrl;
    const timer = setTimeout(() => abortCtrl.abort(), TIMEOUT_MS);

    res.on("close", () => {
        if (!res.writableEnded && !abortCtrl.signal.aborted) {
            abortCtrl.abort();
            abortClaudeServeSession(session.claudeServeSessionId);
        }
    });

    let accumulatedText = "";

    try {
        const resp = await sendToClaudeServe(
            session.claudeServeSessionId,
            fullPrompt,
            systemPrompt,
            abortCtrl.signal,
        );

        if (!resp.ok) {
            const errBody = await resp.text();
            console.error(`[admin-helper] claude-serve error: ${resp.status} ${errBody}`);
            return res.status(502).json({error: "claude-serve 요청 실패"});
        }

        const result = await resp.json();

        // claude-serve 응답에서 텍스트 추출
        for (const part of result.parts || []) {
            if (part.type === "text" && part.text) {
                accumulatedText = part.text;
                break;
            }
        }

        console.log(`[admin-helper] Response received (${accumulatedText.length} chars)`);
    } catch (err) {
        if (err.name === "AbortError") {
            console.log(`[admin-helper] Query aborted for session ${session.id}`);
        } else {
            console.error(`[admin-helper] Query error: ${err.message}`);
            return res.status(502).json({error: "claude-serve 통신 오류"});
        }
    } finally {
        clearTimeout(timer);
        delete session.abortCtrl;
    }

    // DB에 어시스턴트 응답 저장
    if (accumulatedText) {
        db.saveMessage(session.id, "assistant", accumulatedText, null, false);
    }

    // HTTP 응답
    res.json({
        text: accumulatedText,
        thinking: null,
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
    if (session?.claudeServeSessionId) {
        abortClaudeServeSession(session.claudeServeSessionId);
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
    res.json({
        status: "ok",
        model: DEFAULT_MODEL,
        claudeServe: CLAUDE_SERVE_URL,
        policyEnabled: isPolicyConfigured(),
    });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const server = http.createServer(app);
server.listen(PORT, () => {
    console.log(`[admin-helper] listening on http://localhost:${PORT}`);
    console.log(`[admin-helper] model=${DEFAULT_MODEL}, claude-serve=${CLAUDE_SERVE_URL}`);

    // Confluence 정책서 캐시 워밍
    warmCache();

    // claude-serve SSE 프록시 연결
    connectClaudeServeSSE();

    // 7일 지난 세션 자동 삭제 (서버 시작 시 + 매 24시간)
    const cleanup = () => {
        const deleted = db.cleanupExpiredSessions();
        if (deleted > 0) console.log(`[admin-helper] Cleaned up ${deleted} expired sessions`);
    };
    cleanup();
    setInterval(cleanup, 24 * 60 * 60 * 1000);
});
