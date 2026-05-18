const embeddings = require("../../../common/clients/embedding.client");
const { mongoClient } = require("../../../common/connections/mongo.connection");
const elasticClient = require("../../../common/connections/elasticsearch.connection");
const { MongoDBAtlasVectorSearch } = require("@langchain/mongodb");
const deepseek = require("../../../common/clients/deepseek.client");
const rerank = require("../../../common/clients/reranker.client");
const chunks = require("../../../../chunks");
const ConversationModel = require("../../models/conversation");

const TOP_ELASTIC = 15;      // BM25 lấy top N
const TOP_VECTOR = 20;       // Vector search lấy top N
const TOP_RERANK = 5;        // Sau rerank giữ lại top N chunk
exports.chatHybrid = async (req, res) => {
    try {
        const userId=req.user.id
        const { input } = req.body;
        if (!input) {
            return res.status(400).json({
                status: "error",
                message: "Input query is required",
            });
        }
        await ConversationModel.create({
            userId: userId,   // TODO: Lấy userId từ auth
            content: input,
            role: "user"
        })
        const database = mongoClient.db();
        const collection = database.collection("chunks");
        const vectorStore = new MongoDBAtlasVectorSearch(embeddings, {
            collection,
            indexName: "autoembed_index",
            textKey: "text",
            embeddingKey: "embedding",
        });

        // ─── BƯỚC 1: Parallel search ─────────────────────────────────────────
        const [elasticResults, vectorResults] = await Promise.all([
            elasticClient.search({
                index: "sotaysinhvien",
                size: TOP_ELASTIC,
                query: { match: { content: { query: input, operator: "or" } } },
            }),
            vectorStore.similaritySearch(input, TOP_VECTOR),
        ]);

        console.log(`[chat] Elastic: ${elasticResults.hits.hits.length} | Vector: ${vectorResults.length}`);

        // ─── BƯỚC 2: Dedup ───────────────────────────────────────────────────
        const uniqueChunksSet = new Set();
        elasticResults.hits.hits.forEach((hit) => uniqueChunksSet.add(hit._source.content));
        vectorResults.forEach((doc) => uniqueChunksSet.add(doc.pageContent));

        const uniqueDocuments = Array.from(uniqueChunksSet);
        console.log(`[chat] Unique chunks sau dedup: ${uniqueDocuments.length}`);

        if (uniqueDocuments.length === 0) {
            return res.status(200).json({
                status: "success",
                question: input,
                answer: "Tôi không tìm thấy thông tin nào trong tài liệu.",
            });
        }

        // ─── BƯỚC 3: Rerank bằng Jina ────────────────────────────────────────
        const rerankResponse = await fetch("https://api.jina.ai/v1/rerank", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.JINA_API_KEY}`
            },
            body: JSON.stringify({
                model: "jina-reranker-v2-base-multilingual",
                query: input,
                documents: uniqueDocuments,
                top_n: TOP_RERANK
            })
        });

        if (!rerankResponse.ok) {
            throw new Error(`Jina rerank failed: ${rerankResponse.status}`);
        }

        const rerankData = await rerankResponse.json();
        const topChunks = rerankData.results.map(r => ({
            content: uniqueDocuments[r.index],
            score: r.relevance_score
        }));

        topChunks.forEach((chunk, i) => {
            console.log(`[chat] Top ${i + 1} (score=${chunk.score.toFixed(3)}): ${chunk.content}`);
        });

        // ─── BƯỚC 4: Truncate chunk ───────────────────────────────────────────
        const contextText = topChunks
            .map((doc, i) => `[Đoạn ${i + 1}]\n${doc.content}`)
            .join("\n\n");

        const systemPrompt = `Bạn là trợ lý tư vấn sinh viên của Trường Đại học Giao thông vận tải (UTC).
Nhiệm vụ của bạn là trả lời chính xác, ngắn gọn và hữu ích dựa HOÀN TOÀN vào nội dung trong <context>.

## Cách đọc context
Context gồm nhiều đoạn văn bản có cấu trúc như sau:

1. **Breadcrumb** (đường dẫn phân cấp): dòng bắt đầu bằng # và dùng dấu >
   Ví dụ: \`#PHẦN 2 > Chương III > Điều 15\` — cho biết đây là nội dung thuộc phần/chương/điều nào.

2. **Dữ liệu bảng đã flatten** (từ bảng gốc): dùng ký tự | phân cách các trường
   Ví dụ: \`STT: 1 | Đơn vị: Phòng Đào tạo | Địa chỉ: Tầng 1 Nhà A9 | Điện thoại: 024.xxx\`
   → Hãy đọc từng trường (Đơn vị, Địa chỉ, Điện thoại...) như một hàng trong bảng.

3. **Hướng dẫn theo bước**: các trường \`hướng_dẫn_B1:\`, \`hướng_dẫn_B2:\`... là các bước thực hiện tuần tự.

4. **Văn bản thường**: nội dung quy chế, quy định, mô tả.

## Quy tắc trả lời
- Chỉ dùng thông tin trong <context>, tuyệt đối không suy đoán hay dùng kiến thức ngoài.
- Nếu không có thông tin: trả lời đúng 1 câu "Tài liệu không đề cập đến vấn đề này."
- Nếu có thông tin một phần: trả lời phần có, rồi ghi "Tài liệu không đề cập đến [khía cạnh còn lại]."
- Trả lời đúng trọng tâm, không nhắc lại câu hỏi, không diễn giải lan man.

## Định dạng đầu ra
- **In đậm** các từ khóa quan trọng (tên đơn vị, số điện thoại, thời hạn, điều kiện...).
- Dùng danh sách gạch đầu dòng (bullet) khi có từ 3 ý trở lên.
- Nếu câu hỏi hỏi về địa chỉ/liên hệ nhiều đơn vị → trình bày dạng bảng Markdown.
- Nếu câu hỏi hỏi về các bước thực hiện → đánh số thứ tự từng bước.
- Câu trả lời ngắn gọn (≤ 200 từ) trừ khi nội dung thực sự phức tạp.`;

        const userPrompt = `<context>
${contextText}
</context>

**Câu hỏi:** ${input}`;

        const response = await deepseek.chat.completions.create({
            model: "deepseek-chat",
            max_tokens: 1024,
            temperature: 0.1,  // Giảm xuống 0.1 để tăng độ chính xác, bám sát tài liệu
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
        });

        const answer = response.choices[0].message.content.trim();
        await ConversationModel.create({
            userId: userId,
            content: answer,
            role: "assistant"
        });
        return res.status(200).json({
            status: "success",
            question: input,
            answer,
        });

    } catch (err) {
        await ConversationModel.create({
            userId: userId,
            content: `đã có lỗi xảy ra vui lòng thử lại sau!!!`,
            role: "assistant"
        });
        console.error("[chat] Error:", err.message);
        return res.status(500).json({
            status: "error",
            message: "Internal server error",
            error: err.message,
        });
    }
};

exports.getChatHistory = async (req, res) => {
    try {
        const userId = req.user.id;
        const conservation = await ConversationModel.find({ userId }).sort({ createdAt: 1 });
        return res.status(200).json({
            status: "success",
            conversation: conservation
        });
    } catch (err) {
        console.error("[getChatHistory] Error:", err.message);
        return res.status(500).json({
            status: "error",
            message: "Internal server error",
            error: err.message,
        });
    }
}
exports.insertData = async (req, res) => {
    try {
        // ─── STEP 1: Chuẩn bị MongoDB ────────────────────────────────────────
        console.log("[insertData] STEP 1: Chuẩn bị MongoDB...");
        const database = mongoClient.db("SoTaySinhVien");
        const collection = database.collection("chunks");

        // ─── STEP 2: Convert chunks.json → LangChain Document format ─────────
        console.log("[insertData] STEP 2: Convert chunks sang Document format...");
        const documents = chunks.map((chunk) => ({
            pageContent: chunk.content,
            metadata: {
                chunk_id: chunk.chunk_id,
                cloudinary_url: chunk.cloudinary_url,
                cloudinary_id: chunk.cloudinary_id,
                page: chunk.page,
            },
        }));
        console.log(`[insertData] → ${documents.length} documents sẵn sàng`);

        // ─── STEP 3: Insert vào MongoDB Atlas Vector Search ───────────────────
        console.log("[insertData] STEP 3: Insert vào MongoDB...");
        await MongoDBAtlasVectorSearch.fromDocuments(documents, embeddings, {
            collection,
            indexName: "autoembed_index",
            textKey: "text",
            embeddingKey: "embedding",
        });
        console.log("[insertData] ✅ MongoDB done");

        // ─── STEP 4: Index vào Elasticsearch ─────────────────────────────────
        console.log("[insertData] STEP 4: Index vào Elasticsearch...");
        for (const doc of documents) {
            await elasticClient.index({
                index: "sotaysinhvien",
                document: {
                    content: doc.pageContent,
                    metadata: doc.metadata,
                },
            });
        }
        await elasticClient.indices.refresh({ index: "sotaysinhvien" });
        console.log("[insertData] ✅ Elasticsearch done");

        return res.status(200).json({
            status: "success",
            message: "Insert thành công",
            total_chunks: documents.length,
        });

    } catch (err) {
        console.error("[insertData] Error:", err.message);
        return res.status(500).json({
            status: "error",
            message: "Internal server error",
            error: err.message,
        });
    }
};

