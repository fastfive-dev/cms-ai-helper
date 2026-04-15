// ---------------------------------------------------------------------------
// Confluence 정책서 로더 — 동적 fetch + 캐싱
// ---------------------------------------------------------------------------

const CONFLUENCE_SITE = process.env.CONFLUENCE_SITE || "fastfive.atlassian.net";
const CONFLUENCE_EMAIL = process.env.CONFLUENCE_EMAIL || "";
const CONFLUENCE_API_TOKEN = process.env.CONFLUENCE_API_TOKEN || "";
const POLICY_SPACE_ID = process.env.POLICY_SPACE_ID || "58262455";
const POLICY_SPACE_KEY =
    process.env.POLICY_SPACE_KEY || "a4a93dcd2b0c45c78c226ca2bd6e097b";
const POLICY_CACHE_TTL_MS =
    parseInt(process.env.POLICY_CACHE_TTL_MS, 10) || 3600000; // 기본 1시간

const BASE_URL = `https://${CONFLUENCE_SITE}/wiki/api/v2`;

let cache = { content: "", fetchedAt: 0 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAuthHeaders() {
    if (!CONFLUENCE_EMAIL || !CONFLUENCE_API_TOKEN) return null;
    const token = Buffer.from(
        `${CONFLUENCE_EMAIL}:${CONFLUENCE_API_TOKEN}`,
    ).toString("base64");
    return {
        Authorization: `Basic ${token}`,
        Accept: "application/json",
    };
}

/**
 * Confluence storage-format XHTML → 읽기 쉬운 텍스트 변환.
 * 완벽한 파서가 아닌, Claude가 컨텍스트로 소화하기에 충분한 수준의 변환.
 */
function storageToText(html) {
    if (!html) return "";

    let text = html;

    // Confluence 매크로 / 미디어 / 이미지 제거
    text = text.replace(/<ac:[^>]*\/>/g, "");
    text = text.replace(/<ac:[^>]*>[\s\S]*?<\/ac:[^>]*>/g, "");
    text = text.replace(/<ri:[^>]*\/>/g, "");
    text = text.replace(/<ri:[^>]*>[\s\S]*?<\/ri:[^>]*>/g, "");
    text = text.replace(/<img[^>]*\/?>/gi, "");

    // 제목 → Markdown
    text = text.replace(
        /<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/gi,
        (_, level, content) => {
            const clean = content.replace(/<[^>]+>/g, "").trim();
            return "\n" + "#".repeat(parseInt(level)) + " " + clean + "\n";
        },
    );

    // 테이블 → Markdown pipe 형식
    text = text.replace(
        /<table[^>]*>([\s\S]*?)<\/table>/gi,
        (_, tableContent) => {
            const rows = [];
            const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
            let rowMatch;
            let isFirstRow = true;

            while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
                const cells = [];
                const cellRegex = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
                let cellMatch;

                while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
                    const cellText = cellMatch[1]
                        .replace(/<[^>]+>/g, "")
                        .replace(/\s+/g, " ")
                        .trim();
                    cells.push(cellText);
                }

                if (cells.length > 0) {
                    rows.push("| " + cells.join(" | ") + " |");
                    if (isFirstRow) {
                        rows.push(
                            "| " + cells.map(() => "---").join(" | ") + " |",
                        );
                        isFirstRow = false;
                    }
                }
            }

            return "\n" + rows.join("\n") + "\n";
        },
    );

    // 리스트
    text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, content) => {
        const clean = content.replace(/<[^>]+>/g, "").trim();
        return "- " + clean + "\n";
    });

    // Bold
    text = text.replace(
        /<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi,
        "**$1**",
    );

    // 단락·줄바꿈
    text = text.replace(/<br\s*\/?>/gi, "\n");
    text = text.replace(/<\/p>/gi, "\n");
    text = text.replace(/<p[^>]*>/gi, "");
    text = text.replace(/<\/div>/gi, "\n");
    text = text.replace(/<div[^>]*>/gi, "");

    // 나머지 태그 제거
    text = text.replace(/<[^>]+>/g, "");

    // HTML 엔티티 디코딩
    text = text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

    // 공백·노이즈 압축
    text = text.replace(/[ \t]+/g, " ");
    text = text.replace(/\n /g, "\n");
    text = text.replace(/\n{3,}/g, "\n\n");
    // 목차 링크, 이모지 장식 제거
    text = text.replace(/👉🏻목차\s*/g, "");
    text = text.replace(/[\u{1F600}-\u{1F9FF}]/gu, "");
    // 빈 리스트 아이템 제거
    text = text.replace(/^- \s*$/gm, "");
    // 연속 빈 줄 재정리
    text = text.replace(/\n{3,}/g, "\n\n");

    return text.trim();
}

// ---------------------------------------------------------------------------
// Confluence API
// ---------------------------------------------------------------------------

async function fetchAllPages() {
    const headers = getAuthHeaders();
    if (!headers) return [];

    const allPages = [];
    let url = `${BASE_URL}/spaces/${POLICY_SPACE_ID}/pages?body-format=storage&limit=50&status=current`;

    while (url) {
        const resp = await fetch(url, {
            headers,
            signal: AbortSignal.timeout(30_000),
        });
        if (!resp.ok) {
            throw new Error(
                `Confluence API: ${resp.status} ${resp.statusText}`,
            );
        }

        const data = await resp.json();
        allPages.push(...(data.results || []));

        // cursor 기반 페이지네이션
        url = data._links?.next
            ? `https://${CONFLUENCE_SITE}${data._links.next}`
            : null;
    }

    return allPages;
}

function buildPolicyDocument(pages) {
    const sections = [];

    for (const page of pages) {
        const rawHtml = page.body?.storage?.value || "";
        const text = storageToText(rawHtml);
        if (!text.trim()) continue;

        const pageUrl = `https://${CONFLUENCE_SITE}/wiki/spaces/${POLICY_SPACE_KEY}/pages/${page.id}`;
        sections.push(`## ${page.title}\n<!-- source: ${pageUrl} -->\n\n${text}`);
    }

    return sections.join("\n\n---\n\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function isPolicyConfigured() {
    return !!(CONFLUENCE_EMAIL && CONFLUENCE_API_TOKEN);
}

/**
 * 캐시된 정책서 반환. TTL 만료 시 백그라운드 갱신.
 * Confluence 접속 실패 시 stale 캐시 반환.
 */
export async function getPolicyContent() {
    if (!isPolicyConfigured()) return "";

    const now = Date.now();
    if (cache.content && now - cache.fetchedAt < POLICY_CACHE_TTL_MS) {
        return cache.content;
    }

    try {
        console.log("[policy-loader] Fetching policy from Confluence...");
        const pages = await fetchAllPages();
        const content = buildPolicyDocument(pages);

        cache = { content, fetchedAt: now };
        console.log(
            `[policy-loader] Loaded ${pages.length} pages (${content.length} chars)`,
        );
        return content;
    } catch (err) {
        console.error(`[policy-loader] Error: ${err.message}`);
        // 에러 시 stale 캐시라도 반환
        if (cache.content) {
            console.warn("[policy-loader] Using stale cache");
            return cache.content;
        }
        return "";
    }
}

/**
 * 서버 시작 시 캐시 워밍. 실패해도 서버 기동에 영향 없음.
 */
export async function warmCache() {
    if (!isPolicyConfigured()) {
        console.log(
            "[policy-loader] Confluence credentials not set — policy disabled",
        );
        return;
    }
    try {
        await getPolicyContent();
    } catch {
        // warmCache 실패는 무시 — 첫 요청 시 재시도됨
    }
}
