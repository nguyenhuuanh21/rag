

const deepseek = require("../clients/deepseek.client");

// Patterns nhận diện câu hỏi phụ thuộc context.
// Chỉ áp dụng cho câu ngắn (≤ 60 ký) — câu dài thường đã đủ thông tin.
const CONTEXT_DEPENDENT_PATTERNS = [
    /^(còn|vậy còn|thế còn)\s+\S/i,                                   // "còn X thì sao?", "vậy còn Y?"
    /^(vậy|thế)\s+(thì\s+)?(như thế nào|sao|bao nhiêu|là gì|ở đâu)/i, // "vậy thì như thế nào?"
    /^(còn|ngoài ra|ngoài đó|thêm nữa)\b.{0,20}\?/i,                  // "còn gì không?", "ngoài ra thì?"
    /(của|về|liên quan đến)\s+(nó|chúng|cái đó|điều đó|vấn đề đó)\b/i, // "của nó là gì?"
    /^điều kiện (để|để được|để đủ)\s*\??$/i,                           // "Điều kiện để được?"
    /^(thủ tục|hồ sơ|quy trình)\s+(đó|vậy)\s*\??/i,                   // "Thủ tục đó thế nào?"
    /\b(trên|đó|vậy)\s+(thì|là|có|như)\s+(gì|thế nào|bao nhiêu)\s*\??$/i, // "... đó thì là gì?"
    /^(như vậy|như thế)\s+(thì\s+)?(tôi|mình|sinh viên)/i,            // "Như vậy thì sinh viên cần..."
];


function needsRewrite(query) {
    if (query.length > 60) return false;
    return CONTEXT_DEPENDENT_PATTERNS.some((p) => p.test(query.trim()));
}


async function rewriteQueryWithHistory(query, historyMessages) {
    if (!needsRewrite(query)) return query;
    if (!historyMessages || historyMessages.length < 2) return query;

    // Lấy tối đa 3 lượt cuối (6 message) — đủ context, không quá dài
    const recentHistory = historyMessages
        .slice(-6)
        .map((m) => `${m.role === "user" ? "Người dùng" : "Trợ lý"}: ${m.content.slice(0, 250)}`)
        .join("\n---\n");

    try {
        const res = await deepseek.chat.completions.create({
            model: "deepseek-chat",
            max_tokens: 80,
            temperature: 0,
            messages: [
                {
                    role: "system",
                    content:
                        "Bạn là công cụ viết lại câu hỏi. " +
                        "Nhiệm vụ: dựa vào lịch sử hội thoại, viết lại câu hỏi hiện tại thành câu độc lập, " +
                        "rõ ràng, có thể hiểu mà không cần đọc lịch sử. " +
                        "Quy tắc: chỉ trả về câu hỏi đã viết lại (không giải thích, không ngoặc kép, không prefix). " +
                        "Nếu câu hỏi đã đủ rõ, trả về nguyên văn. Tối đa 100 ký tự.",
                },
                {
                    role: "user",
                    content: `Lịch sử hội thoại:\n${recentHistory}\n\nCâu hỏi cần viết lại: ${query}`,
                },
            ],
        });

        const rewritten = res.choices[0].message.content
            .trim()
            .replace(/^["'`""'']|["'`""'']$/g, ""); // bỏ ngoặc kép nếu LLM thêm vào

        if (rewritten && rewritten !== query) {
            console.log(`[rewriter] "${query}" → "${rewritten}"`);
        }
        return rewritten || query;

    } catch (err) {
        // Fail-open: lỗi rewrite không được dừng pipeline chính
        console.warn(`[rewriter] Lỗi, dùng query gốc: ${err.message}`);
        return query;
    }
}

module.exports = { needsRewrite, rewriteQueryWithHistory };
