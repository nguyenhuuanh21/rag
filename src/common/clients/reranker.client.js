// ============================================================
// reranker.client.js — Jina Reranker v2 (multilingual)
//
// Cải tiến so với bản cũ:
//   1. Retry tự động khi gặp lỗi 429 (rate limit) hoặc lỗi mạng
//   2. Timeout 30 giây để không bị treo vô hạn
//   3. Exponential backoff: lần retry 1 chờ 2s, lần 2 chờ 4s, lần 3 chờ 8s
// ============================================================

const MAX_RETRIES = 3;           // Số lần retry tối đa
const BASE_DELAY_MS = 2000;      // Thời gian chờ cơ bản giữa các lần retry (ms)
const TIMEOUT_MS = 30_000;       // Timeout mỗi request (30 giây)

// delay(ms) — trả về Promise chờ đúng ms milliseconds
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Gọi Jina Reranker API để sắp xếp lại các đoạn văn theo độ liên quan.
 *
 * @param {string}   query     — Câu hỏi của người dùng
 * @param {string[]} documents — Danh sách các đoạn văn cần rerank
 * @param {number}   top_n     — Số lượng kết quả muốn giữ lại
 * @returns {{ results: Array<{ index: number, relevance_score: number }> }}
 */
async function rerank(query, documents, top_n = 2) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        // AbortController để ngắt request nếu quá TIMEOUT_MS
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

        try {
            const response = await fetch("https://api.jina.ai/v1/rerank", {
                method: "POST",
                signal: controller.signal,
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${process.env.JINA_API_KEY}`,
                },
                body: JSON.stringify({
                    model: "jina-reranker-v2-base-multilingual",
                    query,
                    documents,
                    top_n,
                }),
            });

            clearTimeout(timeoutId); // Xóa timeout nếu request hoàn thành

            // Thành công → trả về kết quả ngay
            if (response.ok) {
                return await response.json();
            }

            // Lỗi 429 (Too Many Requests) → chờ rồi retry
            if (response.status === 429 && attempt < MAX_RETRIES) {
                // Ưu tiên dùng Retry-After header của Jina nếu có
                const retryAfterHeader = parseInt(response.headers.get("Retry-After") || "0", 10);
                const waitMs = retryAfterHeader > 0
                    ? retryAfterHeader * 1000
                    : BASE_DELAY_MS * Math.pow(2, attempt); // 2s → 4s → 8s

                console.warn(`[reranker] Rate limit (429), thử lại lần ${attempt + 1}/${MAX_RETRIES} sau ${waitMs}ms`);
                await delay(waitMs);
                continue; // Tiếp tục vòng lặp retry
            }

            // Các lỗi HTTP khác → throw ngay, không retry
            const err = new Error(`Rerank API thất bại: HTTP ${response.status}`);
            err.status = response.status;
            throw err;

        } catch (err) {
            clearTimeout(timeoutId);

            // Lỗi timeout (AbortError)
            if (err.name === "AbortError") {
                const timeoutErr = new Error(`Rerank API timeout sau ${TIMEOUT_MS}ms`);
                if (attempt < MAX_RETRIES) {
                    console.warn(`[reranker] Timeout, thử lại lần ${attempt + 1}/${MAX_RETRIES}`);
                    await delay(BASE_DELAY_MS * Math.pow(2, attempt));
                    continue;
                }
                throw timeoutErr;
            }

            // Lỗi mạng (fetch failed) → retry nếu còn lượt
            if (attempt < MAX_RETRIES && !err.status) {
                console.warn(`[reranker] Lỗi mạng (${err.message}), thử lại lần ${attempt + 1}/${MAX_RETRIES}`);
                await delay(BASE_DELAY_MS * Math.pow(2, attempt));
                continue;
            }

            throw err; // Hết retry → throw
        }
    }
}

module.exports = rerank;