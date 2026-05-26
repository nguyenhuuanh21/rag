
const crypto = require("crypto");
const { mongoClient } = require("../../../common/connections/mongo.connection");
const elasticClient = require("../../../common/connections/elasticsearch.connection");
const redisClient = require("../../../common/connections/redis.connection");
const { MongoDBAtlasVectorSearch } = require("@langchain/mongodb");
const deepseek = require("../../../common/clients/deepseek.client");
const rerank = require("../../../common/clients/reranker.client");
const ConversationModel = require("../../models/conversation");
const embeddingModel = require("../../../common/clients/gemini.client");
const chunks = require("../../../../chunks");
const { INTENT, SIMPLE_RESPONSES, classifyIntent, expandAbbreviations, sanitizeInput } = require("../../../common/helpers/intent.helper");
const { buildContextText } = require("../../../common/helpers/context.helper");
const { rewriteQueryWithHistory } = require("../../../common/helpers/queryRewriter.helper");

const TOP_ELASTIC = Number(process.env.TOP_ELASTIC ?? 20);
const TOP_VECTOR = Number(process.env.TOP_VECTOR ?? 20);
const TOP_RERANK = Number(process.env.TOP_RERANK ?? 15);
const CACHE_TTL = 60 * 60 * 2;
const HISTORY_WINDOW = 10;
const LOW_CONFIDENCE_THRESHOLD = 0.1;

const _db = mongoClient.db("SoTaySinhVien");
const _collection = _db.collection("chunks");
const vectorStore = new MongoDBAtlasVectorSearch(embeddingModel, {
    collection: _collection,
    indexName: "autoembed_index",
    textKey: "text",
    embeddingKey: "embedding",
});

const DOCUMENT_TOPICS = `Phần 1: Giới thiệu trường:
  - Giới thiệu chung về trường UTC
  - Đội ngũ và cơ cấu tổ chức
  - Các kênh thông tin online dành cho sinh viên
  - Địa chỉ, điện thoại các đơn vị

Phần 2: Quy chế, Quy định:
  - Quy chế đào tạo đại học (tín chỉ, thi cử, học lại...)
  - Quy định chuẩn đầu ra ngoại ngữ
  - Quy định đánh giá rèn luyện sinh viên
  - Quy định kỷ luật sinh viên
  - Quy định học bổng
  - Quy định chế độ chính sách (miễn giảm học phí, trợ cấp...)
  - Quy định vay vốn tín dụng
  - Quy định quản lý sinh viên ngoại trú

Phần 3: Hướng dẫn thực hiện:
  - Tài khoản đào tạo và đăng ký học
  - Đánh giá rèn luyện và cố vấn học tập
  - Quy trình kỷ luật và chấm dứt kỷ luật
  - Cấp giấy xác nhận chế độ chính sách
  - Cấp giấy xác nhận vay vốn tín dụng
  - Cấp thẻ sinh viên
  - Hoạt động sinh viên, Đoàn, Hội
  - Thư viện
  - Ký túc xá
  - Thủ tục sinh viên ngoại trú
  - Y tế và bảo hiểm y tế
  - Học phí, học bổng, trợ cấp
  - Email sinh viên
  - Quản lý hồ sơ và thanh toán tài sản ra trường`;

const SYSTEM_PROMPT = `Bạn là trợ lý tư vấn sinh viên chính thức của Trường Đại học Giao thông vận tải (UTC), được xây dựng dựa trên tài liệu "Sổ tay sinh viên UTC".

## VAI TRÒ
Nhiệm vụ duy nhất của bạn là trả lời câu hỏi của sinh viên dựa trên nội dung trong <context> được cung cấp. Bạn không phải chatbot thông thường — bạn là công cụ tra cứu chính xác, trung thực, và hữu ích nhất có thể.

## CẤU TRÚC DỮ LIỆU TRONG CONTEXT
Mỗi đoạn trong <context> gồm:
- Nguồn (breadcrumb): đường dẫn phân cấp Phần > Chương > Mục — dùng nguyên văn khi trích dẫn
- Vị trí: số trang trong PDF gốc
- Nội dung: có thể là văn bản quy định, bảng flatten (dùng ký tự |), hoặc hướng dẫn theo bước (hướng_dẫn_B1:, B2:...)

Cách đọc từng loại:
1. Bảng flatten: STT: 1 | Đơn vị: Phòng Đào tạo | Địa chỉ: Tầng 1 Nhà A9 | Điện thoại: 024.xxx → đọc từng trường như một hàng bảng
2. Hướng dẫn bước: hướng_dẫn_B1:, B2:... → các bước thực hiện tuần tự
3. Văn bản quy định: trích dẫn chính xác điều khoản, không diễn giải sai lệch

## QUY TRÌNH XỬ LÝ — TUÂN THỦ THEO THỨ TỰ

BƯỚC 1 — PHÂN TÍCH CÂU HỎI:
Xác định câu hỏi thuộc loại nào:
- RÕ RÀNG: có chủ đề + mục đích cụ thể → chuyển sang BƯỚC 2
- MƠ HỒ: chỉ là keyword đơn lẻ, không rõ muốn biết gì (ví dụ: "quy định", "học phí", "thủ tục", "kỷ luật") → chuyển sang BƯỚC 3

BƯỚC 2 — TRẢ LỜI CÂU HỎI RÕ RÀNG:
2a. Tìm thông tin trong <context>.
2b. Nếu tìm thấy đủ → trả lời đầy đủ + trích dẫn nguồn.
2c. Nếu tìm thấy một phần → trả lời phần có + ghi rõ "Tài liệu không đề cập đến [khía cạnh còn lại]."
2d. Nếu không tìm thấy gì → trả lời đúng 1 câu: "Tài liệu không đề cập đến vấn đề này."

BƯỚC 3 — XỬ LÝ CÂU HỎI MƠ HỒ:
3a. Đối chiếu keyword trong câu hỏi với danh sách chủ đề sau:

<document_topics>
${DOCUMENT_TOPICS}
</document_topics>

3b. Nếu keyword KHỚP với ít nhất một mục trong danh sách trên:
→ KHÔNG trả lời nội dung, KHÔNG nói "tài liệu không đề cập"
→ Liệt kê các khía cạnh liên quan từ danh sách (chỉ lấy từ danh sách, không bịa thêm)
→ Yêu cầu sinh viên hỏi cụ thể hơn theo mẫu sau:

"[Từ khóa] là chủ đề có nhiều nội dung trong Sổ tay sinh viên. Bạn muốn tìm hiểu cụ thể về khía cạnh nào?

- [khía cạnh 1 liên quan từ danh sách]
- [khía cạnh 2 liên quan từ danh sách]
- [khía cạnh 3 liên quan từ danh sách]
...

Hãy cho tôi biết bạn cần thông tin gì để tôi hỗ trợ chính xác nhất."

3c. Nếu keyword KHÔNG khớp với bất kỳ mục nào → trả lời đúng 1 câu: "Tài liệu không đề cập đến vấn đề này."

## QUY TẮC TRÍCH DẪN NGUỒN — BẮT BUỘC VỚI MỌI THÔNG TIN QUAN TRỌNG
Sau mỗi thông tin quan trọng PHẢI ghi nguồn trên một dòng riêng theo định dạng:
Nguồn: [breadcrumb đầy đủ] — Trang [số trang]

Ví dụ:
Nguồn: PHẦN 3 HƯỚNG DẪN THỰC HIỆN > XIII. HỌC PHÍ - HỌC BỔNG, TRỢ CẤP > 2. Miễn giảm học phí — Trang 55–56

Nếu nhiều thông tin từ cùng một nguồn → chỉ ghi một lần ở cuối đoạn.

## ĐỊNH DẠNG ĐẦU RA — BẮT BUỘC TUÂN THỦ TUYỆT ĐỐI
KHÔNG dùng bất kỳ ký tự Markdown nào: **, __, ##, >, _, \`\`\`, *

Thay vào đó:
- Từ khóa quan trọng (tên đơn vị, số phòng, điện thoại, thời hạn, điều kiện): VIẾT HOA TOÀN BỘ
- Danh sách từ 3 ý trở lên: dùng dấu (-) và xuống dòng
- Các bước thực hiện: đánh số thứ tự, mỗi bước một dòng
- Bảng nhiều đơn vị: dùng | phân cách, mỗi đơn vị một dòng
- Nguồn trích dẫn: đặt trên dòng riêng

## NGUYÊN TẮC BẤT BIẾN
- Tuyệt đối không bịa đặt, không dùng kiến thức ngoài <context> và <document_topics>
- Không nhắc lại câu hỏi, không mở đầu bằng "Dựa vào tài liệu..." hay "Theo context..."
- Không xin lỗi dài dòng, không giải thích lý do không trả lời được
- Tối đa 400 từ trừ khi nội dung thực sự phức tạp`;


const getConversation = async (chatId, userId) => {
    let conv = await ConversationModel.findOne({ userId, _id: chatId });
    return conv;
};


function applyRRF(elasticHits, vectorDocs, topN = TOP_RERANK, k = 60) {
    const scores = new Map(); // key: content → { score, pages }

    const addScore = (content, pages, rank) => {
        const existing = scores.get(content) || { score: 0, pages };
        scores.set(content, {
            ...existing,
            score: existing.score + 1 / (k + rank + 1),
        });
    };

    elasticHits.forEach((hit, rank) =>
        addScore(hit._source.content, hit._source.metadata?.page || [], rank));
    vectorDocs.forEach((doc, rank) =>
        addScore(doc.pageContent, doc.metadata?.page || [], rank));

    return Array.from(scores.entries())
        .map(([content, { score, pages }]) => ({ content, pages, score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topN);
}

exports.chatHybrid = async (req, res) => {
    const t0 = Date.now();
    let query = "";
    let conversation = null;
    try {
        const chatId = req.params.chatId;
        const userId = req.user.id;
        conversation = await getConversation(chatId, userId);
        if (!conversation) {
            return res.status(404).json({ status: "error", message: "Conversation not found" });
        }
        const { input } = req.body;

        if (!input?.trim()) {
            return res.status(400).json({ status: "error", message: "Câu hỏi không được để trống" });
        }
        if (input.trim().length > 300) {
            return res.status(400).json({
                status: "error",
                message: `Câu hỏi quá dài, tối đa 300 ký tự`,
            });
        }
        query = input.trim();
        conversation.messages.push({ role: "user", content: query });
        // BƯỚC 2: Phân loại intent
        const intent = classifyIntent(query);
        console.log(`[chat] Intent: ${intent} | "${query.slice(0, 50)}"`);

        if (intent !== INTENT.DOCUMENT_QUERY) {
            let answer;

            if (intent === INTENT.FOLLOWUP) {
                // FOLLOWUP: câu hỏi tiếp theo dựa trên lịch sử hội thoại.
                // Không cần RAG vì không có từ khóa tìm kiếm mới — chỉ cần
                // đưa lịch sử hội thoại cho LLM và hỏi tiếp.
                // Ví dụ: "còn gì nữa không?", "nói thêm đi", "cho ví dụ"
                if (conversation.messages.length <= 2) {
                    answer = "Bạn vừa bắt đầu cuộc trò chuyện. Bạn muốn hỏi về chủ đề gì trong Sổ tay sinh viên UTC?";
                } else {
                    const historyForFollowup = conversation.messages
                        .slice(0, -1)
                        .slice(-10)
                        .map((m) => ({ role: m.role, content: m.content }));
                    const followupContext = conversation.lastUsedChunks?.length > 0
                        ? buildContextText(conversation.lastUsedChunks)
                        : null;
                    const llmRes = await deepseek.chat.completions.create({
                        model: "deepseek-chat",
                        max_tokens: 512,
                        temperature: 0.1,
                        messages: [
                            { role: "system", content: SYSTEM_PROMPT },
                            ...historyForFollowup,
                            {
                                role: "user",
                                content: followupContext
                                    ? `${query}\n\n<context>\n${followupContext}\n</context>\n\n(Đây là câu hỏi tiếp theo. Hãy bổ sung thông tin dựa trên <context> trên.)`
                                    : `${query}\n\n(Câu hỏi tiếp theo — hãy bổ sung từ nội dung đã trả lời ở trên.)`,
                            },
                        ],
                    });
                    answer = llmRes.choices[0].message.content.trim();
                }
            } else {
                answer = SIMPLE_RESPONSES[intent];
            }

            conversation.messages.push({ role: "assistant", content: answer });
            conversation.lastActiveAt = new Date();
            await conversation.save();

            console.log(`[chat] Simple intent handled in ${Date.now() - t0}ms`);
            return res.status(200).json({ status: "success", question: query, answer });
        }

        //BƯỚC 3: Kiểm tra Redis cache
        // Cache key = base64(lowercase query), giúp các câu hỏi giống nhau dùng chung cache.
        const cacheKey = `chat:${userId}:${crypto.createHash("sha256").update(query.toLowerCase()).digest("hex").slice(0, 32)}`;
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                console.log(`[chat] Cache HIT | "${query.slice(0, 50)}"`);
                const { answer } = JSON.parse(cached);
                conversation.messages.push({ role: "assistant", content: answer });
                conversation.lastActiveAt = new Date();
                await conversation.save();
                return res.status(200).json({ status: "success", question: query, answer, cached: true });
            }
        } catch (cacheErr) {
            console.warn("[chat] Cache đọc lỗi (tiếp tục bình thường):", cacheErr.message);
        }

        //BƯỚC 4: Lấy hoặc tạo conversation


        // searchQuery: rewrite nếu câu hỏi phụ thuộc context → sau đó sanitize + expand viết tắt
        // query gốc giữ nguyên cho: hiển thị, lưu hội thoại, cache key, LLM user prompt
        const rewrittenQuery = await rewriteQueryWithHistory(query, conversation.messages.slice(0, -1));
        const searchQuery = expandAbbreviations(sanitizeInput(rewrittenQuery));

        const t1 = Date.now();
        const [elasticResults, vectorResults] = await Promise.all([
            // BM25: must ≥50% tokens + phrase boost
            elasticClient.search({
                index: "sotaysinhvien",
                size: TOP_ELASTIC,
                query: {
                    bool: {
                        must: { match: { content: { query: searchQuery, operator: "or", minimum_should_match: "50%" } } },
                        should: { match_phrase: { content: { query: searchQuery, boost: 2, slop: 1 } } },
                    },
                },
            }),
            vectorStore.similaritySearch(searchQuery, TOP_VECTOR),
        ]);
        console.log(`[chat] Search: ${Date.now() - t1}ms | ES=${elasticResults.hits.hits.length} Vec=${vectorResults.length}`);

        //BƯỚC 6: Dedup — loại bỏ chunk trùng từ 2 nguồn
        // Dùng Map với key = nội dung để tự động loại bỏ chunk xuất hiện ở cả hai nguồn.
        const seen = new Map();
        elasticResults.hits.hits.forEach((hit) => {
            const c = hit._source.content;
            if (!seen.has(c)) seen.set(c, { content: c, pages: hit._source.metadata?.page || [] });
        });
        vectorResults.forEach((doc) => {
            const c = doc.pageContent;
            if (!seen.has(c)) seen.set(c, { content: c, pages: doc.metadata?.page || [] });
        });
        const uniqueDocs = Array.from(seen.values());
        console.log(`[chat] Dedup: ${uniqueDocs.length} unique chunks`);

        // Không tìm thấy gì → hướng dẫn user thay vì chỉ báo lỗi
        if (uniqueDocs.length === 0) {
            const noInfo =
                `Tôi không tìm thấy thông tin liên quan trong Sổ tay sinh viên UTC.\n\n` +
                `Bạn có thể thử hỏi về:\n` +
                `- Học phí, học bổng, miễn giảm học phí\n` +
                `- Quy chế đào tạo, thi cử, điều kiện học lại\n` +
                `- Ký túc xá, y tế, bảo hiểm y tế\n` +
                `- Kỷ luật, đánh giá rèn luyện sinh viên\n` +
                `- Thủ tục hành chính, cấp giấy tờ\n\n` +
                `Hoặc liên hệ PHÒNG ĐÀO TẠO (Tầng 1, Nhà A9) để được hỗ trợ trực tiếp.`;
            conversation.messages.push({ role: "assistant", content: noInfo });
            conversation.lastActiveAt = new Date();
            await conversation.save();
            return res.status(200).json({ status: "success", question: query, answer: noInfo });
        }

        //BƯỚC 7: Rerank — thử Jina trước, fallback RRF nếu lỗi
        let topChunks;
        const t2 = Date.now();
        try {
            const texts = uniqueDocs.map((d) => d.content);
            const rerankData = await rerank(query, texts, TOP_RERANK);
            topChunks = rerankData.results.map((r) => ({
                content: uniqueDocs[r.index].content,
                pages: uniqueDocs[r.index].pages,
                score: r.relevance_score,
            }));
            console.log(`[chat] Rerank (Jina): ${Date.now() - t2}ms | kept=${topChunks.length}`);
        } catch (rerankErr) {
            // RRF không cần API ngoài, tính toán local bằng rank từ cả 2 nguồn
            console.warn(`[chat] Jina lỗi (${rerankErr.message}), dùng RRF fallback`);
            topChunks = applyRRF(elasticResults.hits.hits, vectorResults, TOP_RERANK);
        }
        conversation.lastUsedChunks = topChunks.map(c => ({
            content: c.content,
            pages: c.pages
        }));
        // Log 3 chunk tốt nhất để debug
        topChunks.forEach((c, i) =>
            console.log(`[chat] #${i + 1} score=${c.score?.toFixed(3) ?? "rrf"} pages=${JSON.stringify(c.pages)} | ${c.content}`));

        // Kiểm tra độ tin cậy: nếu score cao nhất < ngưỡng thì context có thể không liên quan
        const isLowConfidence = topChunks.length > 0 &&
            topChunks[0].score !== undefined &&
            topChunks[0].score < LOW_CONFIDENCE_THRESHOLD;
        if (isLowConfidence) {
            console.log(`[chat] Low confidence: top score=${topChunks[0].score.toFixed(3)}, threshold=${LOW_CONFIDENCE_THRESHOLD}`);
        }

        //BƯỚC 8: Build context
        const contextText = buildContextText(topChunks);

        //BƯỚC 9: Build user prompt
        const confidenceNote = isLowConfidence
            ? "\n\nLưu ý: Tài liệu tìm được có độ liên quan thấp. Nếu không có thông tin rõ ràng, hãy ghi \"Tài liệu không đề cập rõ\" và khuyến nghị sinh viên liên hệ phòng ban liên quan."
            : "";

        const userPrompt = `<context>
${contextText}
</context>

Câu hỏi: ${query}

Yêu cầu: Trả lời dựa hoàn toàn vào <context> trên. Sau mỗi thông tin quan trọng, ghi rõ nguồn theo định dạng (Nguồn: [breadcrumb] — [trang]).${confidenceNote}`;

        // BƯỚC 10: Gọi LLM ─────────────────────────────────────────────────
        // Lấy lịch sử hội thoại: bỏ tin nhắn cuối (user vừa push) vì sẽ thay
        // bằng userPrompt (phiên bản có context). Lý do: tránh gửi câu hỏi 2 lần.
        const historyMsgs = conversation.messages
            .slice(0, -1)               // Bỏ tin nhắn user vừa push
            .slice(-(HISTORY_WINDOW * 2)) // Lấy tối đa HISTORY_WINDOW cặp Q&A
            .map((m) => ({ role: m.role, content: m.content }));

        const t3 = Date.now();
        const llmRes = await deepseek.chat.completions.create({
            model: "deepseek-chat",
            max_tokens: 1024,
            temperature: 0.1,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                ...historyMsgs,
                { role: "user", content: userPrompt },
            ],
        });
        console.log(`[chat] LLM: ${Date.now() - t3}ms`);

        const answer = llmRes.choices[0].message.content.trim();

        //BƯỚC 11: Lưu conversation 
        conversation.messages.push({ role: "assistant", content: answer });
        conversation.lastActiveAt = new Date();

        await conversation.save();

        redisClient
            .setEx(cacheKey, CACHE_TTL, JSON.stringify({ answer }))
            .catch((e) => console.warn("[chat] Cache ghi lỗi:", e.message));

        console.log(`[chat] Tổng: ${Date.now() - t0}ms`);
        return res.status(200).json({ status: "success", question: query, answer });

    } catch (err) {
        console.error(`[chat] Fatal error: ${err.message}`);
        try {
            if (conversation) {
                const lastMsg = conversation.messages[conversation.messages.length - 1];
                if (lastMsg?.role === "user") {
                    // User message đã push, chỉ cần thêm error response
                    conversation.messages.push({ role: "assistant", content: "Đã có lỗi xảy ra, vui lòng thử lại sau!" });
                } else if (query) {
                    // User message chưa push (lỗi xảy ra trước bước push)
                    conversation.messages.push({ role: "user", content: query });
                    conversation.messages.push({ role: "assistant", content: "Đã có lỗi xảy ra, vui lòng thử lại sau!" });
                }
                conversation.lastActiveAt = new Date();
                await conversation.save();
            }
        } catch (_) { }
        return res.status(500).json({ status: "error", message: "Internal server error" });
    }
};
exports.createConversation = async (req, res) => {
    try {
        const { name } = req.body;
        const userId = req.user.id;
        const newConversation = await ConversationModel.create({
            userId,
            name: name,
            messages: [{
                role: "assistant",
                content: "Xin chào! Tôi là trợ lý tư vấn sinh viên khóa 63 của Trường Đại học Giao thông vận tải (UTC). Tôi có thể giúp bạn tra cứu thông tin trong Sổ tay sinh viên dành cho sinh viên khóa 63 hệ chính quy. Bạn cần hỗ trợ gì không?",
            }],
        });
        if (!newConversation) {
            return res.status(500).json({ status: "error", message: "Không thể tạo cuộc trò chuyện mới" });
        }
        return res.status(200).json({
            status: "success",
            conversation:{
                _id: newConversation._id,
                name: newConversation.name,
                lastActiveAt: newConversation.lastActiveAt
            }

        });
    } catch (err) {
        console.error(`[createConversation] Error: ${err.message}`);
        return res.status(500).json({ status: "error", message: "Internal server error", error: err.message });
    }
}
exports.getAllConversations = async (req, res) => {
    try {
        const userId = req.user.id;
        let conversations = await ConversationModel.find({ userId }).sort({ lastActiveAt: -1 });
        if (conversations.length === 0) {
            const newConversation = await ConversationModel.create({
                userId,
                messages: [{
                    role: "assistant",
                    content: "Xin chào! Tôi là trợ lý tư vấn sinh viên khóa 63 của Trường Đại học Giao thông vận tải (UTC). Tôi có thể giúp bạn tra cứu thông tin trong Sổ tay sinh viên dành cho sinh viên khóa 63 hệ chính quy. Bạn cần hỗ trợ gì không?",
                }],
            });
            conversations = [newConversation];
            return res.status(200).json({
                status: "success",
                total: 1,
                conversations: conversations.map(c => ({
                    _id: c._id,
                    name: c.name,
                    lastActiveAt: c.lastActiveAt
                }))
            });
        }
        return res.status(200).json({
            status: "success",
            total: conversations.length,
            conversations: conversations.map(c => ({
                _id: c._id,
                name: c.name,
                lastActiveAt: c.lastActiveAt
            }))
        });
    } catch (err) {
        console.error(`[getAllConversations] Error: ${err.message}`);
        return res.status(500).json({ status: "error", message: "Internal server error", error: err.message });
    }
}
exports.getChatHistory = async (req, res) => {
    try {
        const chatId = req.params.chatId;
        const userId = req.user.id;
        const conversation = await ConversationModel.findOne({ userId, _id: chatId });
        if (!conversation) {
            return res.status(404).json({ status: "error", message: "Conversation not found" });
        }
        return res.status(200).json({
            status: "success",
            conversation: conversation.messages,
        });
    } catch (err) {
        console.error("[getChatHistory] Error:", err.message);
        return res.status(500).json({ status: "error", message: "Internal server error" });
    }
};
exports.clearChatHistory = async (req, res) => {
    try {
        const { chatId } = req.params;
        const userId = req.user.id;
        const conversation = await ConversationModel.findOne({ userId, _id: chatId });
        if (!conversation) {
            return res.status(404).json({ status: "error", message: "không tìm thấy cuộc trò chuyện" });
        }
        await ConversationModel.deleteOne(
            { userId, _id: chatId },
        );
        return res.status(200).json({ status: "success", message: "cuộc trò chuyện đã được xóa",conversationId: chatId });
    } catch (err) {
        console.error("[clearChatHistory] Error:", err.message);
        return res.status(500).json({ status: "error", message: "Internal server error" });
    }
};
exports.searchConversations = async (req, res) => {
    try {
        const userId = req.user.id;
        const keyword = req.body.keyword?.trim();

        if (!keyword) {
            return res.status(400).json({ status: "error", message: "Thiếu từ khóa tìm kiếm" });
        }
        if (keyword.length < 2) {
            return res.status(400).json({ status: "error", message: "Từ khóa phải có ít nhất 2 ký tự" });
        }

        const conversations = await ConversationModel.find(
            {
                userId,
                $text: { $search: keyword },
            },
            { score: { $meta: "textScore" }, name: 1, lastActiveAt: 1, messages: 1 }
        ).sort({ score: { $meta: "textScore" }, lastActiveAt: -1 });

        const keywordRegex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

        const results = conversations.map((conv) => {
            const matchedMessages = conv.messages
                .filter((m) => keywordRegex.test(m.content))
                .map((m) => {
                    const idx = m.content.search(keywordRegex);
                    const start = Math.max(0, idx - 25);
                    const end = Math.min(m.content.length, idx + 25);
                    let preview = m.content.slice(start, end).trim();
                    if (start > 0) preview = "..." + preview;
                    if (end < m.content.length) preview = preview + "...";

                    return {
                        role: m.role,
                        preview,
                        msgId: m._id,
                        fullMatch: m.content.slice(idx, idx + keyword.length),
                    };
                })
                .slice(0, 3);

          

            return {
                _id: conv._id,
                name: conv.name,
                lastActiveAt: conv.lastActiveAt,
                matchedMessages,   // preview các tin nhắn match
                nameMatch: keywordRegex.test(conv.name), // có match ở tên không
            };
        }).filter((conv) => conv.matchedMessages.length > 0 || conv.nameMatch);;

        return res.status(200).json({
            status: "success",
            keyword,
            total: results.length,
            results,
        });

    } catch (err) {
        console.error("[searchConversations] Error:", err.message);
        return res.status(500).json({ status: "error", message: "Internal server error" });
    }
};
exports.insertData = async (req, res) => {
    try {
        console.log("[insertData] Bắt đầu...");

        // STEP 1: Xóa data cũ MongoDB
        await _collection.deleteMany({});
        console.log("[insertData] Đã xóa data cũ MongoDB");

        // STEP 2: Xóa data cũ Elasticsearch
        const indexExists = await elasticClient.indices.exists({ index: "sotaysinhvien" });
        if (indexExists) {
            await elasticClient.deleteByQuery({ index: "sotaysinhvien", query: { match_all: {} } });
            await elasticClient.indices.refresh({ index: "sotaysinhvien" });
            console.log("[insertData] Đã xóa data cũ Elasticsearch");
        }

        // STEP 3: Convert chunks.js → LangChain Document format
        const documents = chunks.map((chunk) => ({
            pageContent: chunk.content,
            metadata: { chunk_id: chunk.chunk_id, page: chunk.page },
        }));
        console.log(`[insertData] ${documents.length} documents sẵn sàng`);

        // STEP 4: Insert vào MongoDB theo batch (tránh quá tải Gemini Embedding API)
        const BATCH_SIZE = 10;
        for (let i = 0; i < documents.length; i += BATCH_SIZE) {
            const batch = documents.slice(i, i + BATCH_SIZE);
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(documents.length / BATCH_SIZE);
            console.log(`[insertData] MongoDB batch ${batchNum}/${totalBatches}`);
            await MongoDBAtlasVectorSearch.fromDocuments(batch, embeddingModel, {
                collection: _collection,
                indexName: "autoembed_index",
                textKey: "text",
                embeddingKey: "embedding",
            });
        }
        console.log("[insertData] MongoDB done");

        // STEP 5: Index vào Elasticsearch
        for (const doc of documents) {
            await elasticClient.index({
                index: "sotaysinhvien",
                document: { content: doc.pageContent, metadata: doc.metadata },
            });
        }
        await elasticClient.indices.refresh({ index: "sotaysinhvien" });
        console.log("[insertData] Elasticsearch done");

        return res.status(200).json({ status: "success", message: "Insert thành công", total_chunks: documents.length });

    } catch (err) {
        console.error("[insertData] Error:", err.message);
        return res.status(500).json({ status: "error", message: "Internal server error" });
    }
};

