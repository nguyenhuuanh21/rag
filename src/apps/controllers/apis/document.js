
const { mongoClient } = require("../../../common/connections/mongo.connection");
const elasticClient = require("../../../common/connections/elasticsearch.connection");
const { MongoDBAtlasVectorSearch } = require("@langchain/mongodb");
const deepseek = require("../../../common/clients/deepseek.client");
const rerank = require("../../../common/clients/reranker.client");
const chunks = require("../../../../chunks");
const ConversationModel = require("../../models/conversation");
const embeddingModel = require("../../../common/clients/gemini.client");
const TOP_ELASTIC = Number(process.env.TOP_ELASTIC) || 15;      // BM25 lấy top N
const TOP_VECTOR = Number(process.env.TOP_VECTOR) || 20;       // Vector search lấy top N
const TOP_RERANK = Number(process.env.TOP_RERANK) || 8;        // Sau rerank giữ lại top N chunk
const getOrCreateConversation = async (userId) => {
    let conversation = await ConversationModel.findOne({ userId });
    if (!conversation) {
        conversation = await ConversationModel.create({ userId, messages: [] });
    }
    return conversation;
};
exports.chatHybrid = async (req, res) => {
    try {
        const userId = req.user.id;
        const { input } = req.body;

        if (!input) {
            return res.status(400).json({
                status: "error",
                message: "Input query is required",
            });
        }

        let conversation = await ConversationModel.findOne({ userId });

        // Lưu message user
        conversation.messages.push({ role: "user", content: input });

        const database = mongoClient.db("SoTaySinhVien");
        const collection = database.collection("chunks");
        const vectorStore = new MongoDBAtlasVectorSearch(embeddingModel, {
            collection,
            indexName: "autoembed_index",
            textKey: "text",
            embeddingKey: "embedding",
        });

        //  BƯỚC 1: Parallel search 
        const [elasticResults, vectorResults] = await Promise.all([
            elasticClient.search({
                index: "sotaysinhvien",
                size: TOP_ELASTIC,
                query: { match: { content: { query: input, operator: "or" } } },
            }),
            vectorStore.similaritySearch(input, TOP_VECTOR),
        ]);

        console.log(
            `[chat] Elastic: ${elasticResults.hits.hits.length} | Vector: ${vectorResults.length}`
        );

        //  BƯỚC 2: Dedup 
        const uniqueChunksMap = new Map();

        elasticResults.hits.hits.forEach((hit) => {
            const content = hit._source.content;
            const pages = hit._source.metadata?.page || [];
            if (!uniqueChunksMap.has(content)) {
                uniqueChunksMap.set(content, { content, pages });
            }
        });

        vectorResults.forEach((doc) => {
            const content = doc.pageContent;
            const pages = doc.metadata?.page || [];
            if (!uniqueChunksMap.has(content)) {
                uniqueChunksMap.set(content, { content, pages });
            }
        });

        const uniqueDocuments = Array.from(uniqueChunksMap.values());
        const uniqueTexts = uniqueDocuments.map((d) => d.content);

        console.log(`[chat] Unique chunks sau dedup: ${uniqueDocuments.length}`);

        if (uniqueDocuments.length === 0) {
            conversation.messages.push({
                role: "assistant",
                content: "Tôi không tìm thấy thông tin nào trong tài liệu.",
            });
            conversation.lastActiveAt = new Date();
            await conversation.save();

            return res.status(200).json({
                status: "success",
                question: input,
                answer: "Tôi không tìm thấy thông tin nào trong tài liệu.",
            });
        }

        //  BƯỚC 3: Rerank bằng Jina 
        const rerankData = await rerank(input, uniqueTexts, TOP_RERANK);

        const topChunks = rerankData.results.map((r) => ({
            content: uniqueDocuments[r.index].content,
            pages: uniqueDocuments[r.index].pages,
            score: r.relevance_score,
        }));

     

        topChunks.forEach((chunk, i) => {
            console.log(
                `[chat] Top ${i + 1} (score=${chunk.score.toFixed(3)}, pages=${JSON.stringify(chunk.pages)}): ${chunk.content.slice(0, 80)}...`
            );
        });

        //  BƯỚC 4: Build context 
        const contextText = topChunks
            .map((doc, i) => {
                const pages = doc.pages || [];
                const pageInfo =
                    pages.length === 0
                        ? "Không rõ trang"
                        : pages.length === 1
                            ? `Trang ${pages[0]}`
                            : `Trang ${pages[0]}–${pages[pages.length - 1]}`;

                return `[Đoạn ${i + 1}]\n Vị trí: ${pageInfo}\n---\n${doc.content.trim()}`;
            })
            .join("\n\n");

        //  BƯỚC 5: Gọi DeepSeek 
        const systemPrompt = `Bạn là trợ lý tư vấn sinh viên chính thức của Trường Đại học Giao thông vận tải (UTC).
Bạn được cung cấp các đoạn trích từ tài liệu "Sổ tay sinh viên UTC". Mỗi đoạn có:
-  Nguồn: đường dẫn phân cấp (breadcrumb) cho biết nội dung thuộc Phần/Chương/Mục nào trong tài liệu
-  Vị trí: số trang trong tài liệu gốc (PDF Sổ tay sinh viên)

## NHIỆM VỤ
Trả lời câu hỏi của sinh viên DỰA HOÀN TOÀN vào nội dung trong <context>. Tuyệt đối không bịa đặt hay dùng kiến thức ngoài tài liệu.

## QUY TẮC TRÍCH DẪN NGUỒN — BẮT BUỘC
Sau MỖI thông tin quan trọng trong câu trả lời, PHẢI ghi nguồn theo đúng định dạng sau:
(Nguồn: [nội dung breadcrumb] — [vị trí trang])

Ví dụ minh họa:
(Nguồn: PHẦN 3 HƯỚNG DẪN THỰC HIỆN > XIII. HỌC PHÍ - HỌC BỔNG, TRỢ CẤP > 2. Miễn giảm học phí — Trang 55–56)

Nếu nhiều thông tin đến từ cùng một nguồn, chỉ cần ghi một lần ở cuối đoạn đó.

## CÁCH ĐỌC DỮ LIỆU TRONG CONTEXT
1. Breadcrumb (dòng Nguồn): cho biết vị trí logic trong tài liệu — dùng nguyên văn để trích dẫn.
2. Dữ liệu bảng flatten (dùng ký tự |): đọc từng trường như một hàng trong bảng.
   Ví dụ: STT: 1 | Đơn vị: Phòng Đào tạo | Địa chỉ: Tầng 1 Nhà A9 | Điện thoại: 024.xxx
3. Hướng dẫn theo bước: các trường hướng_dẫn_B1:, hướng_dẫn_B2:... là các bước thực hiện tuần tự.
4. Văn bản quy định/mô tả: đọc và trích dẫn chính xác điều khoản.

## QUY TẮC TRẢ LỜI
- Chỉ dùng thông tin trong <context>, không suy đoán hay bổ sung ngoài.
- Không tìm thấy thông tin: trả lời đúng 1 câu "Tài liệu không đề cập đến vấn đề này."
- Có thông tin một phần: trả lời phần có + ghi rõ "Tài liệu không đề cập đến [khía cạnh còn lại]."
- KHÔNG nhắc lại câu hỏi, KHÔNG mở đầu bằng "Dựa vào tài liệu..." hay "Theo context...".
- Câu trả lời ngắn gọn, súc tích, tối đa 250 từ trừ khi nội dung thực sự phức tạp.

## ĐỊNH DẠNG ĐẦU RA — BẮT BUỘC TUÂN THỦ
TUYỆT ĐỐI KHÔNG dùng ký tự Markdown như **, __, ##, >, _, \`\`\` trong câu trả lời.
Thay vào đó dùng các quy tắc sau:

- Từ khóa quan trọng (tên đơn vị, số phòng, số điện thoại, thời hạn, điều kiện): viết HOA TOÀN BỘ.
  Ví dụ: Liên hệ PHÒNG ĐÀO TẠO, tầng 1 nhà A9, số điện thoại 024.37663473.

- Danh sách (khi có 3 ý trở lên): dùng dấu gạch đầu dòng (-) và xuống dòng.
  Ví dụ:
  Các giấy tờ cần nộp:
  - Đơn xin miễn giảm học phí
  - Giấy xác nhận hộ nghèo
  - Bản sao học bạ

- Các bước thực hiện: đánh số thứ tự, mỗi bước một dòng.
  Ví dụ:
  Bước 1: Điền đơn theo mẫu tại phòng Công tác sinh viên.
  Bước 2: Nộp đơn kèm hồ sơ trước ngày 15 hàng tháng.
  Bước 3: Nhận kết quả sau 5 ngày làm việc.

- Bảng thông tin nhiều đơn vị: dùng dấu | để phân cách, mỗi đơn vị một dòng.
  Ví dụ:
  Đơn vị            | Địa chỉ          | Điện thoại
  Phòng Đào tạo     | Tầng 1 nhà A9    | 024.37663473
  Phòng Công tác SV | Tầng 2 nhà A1    | 024.37764543

- Trích dẫn nguồn: đặt trên một dòng riêng, không dùng ký tự đặc biệt.
  Ví dụ:
  Nguồn: PHẦN 1 GIỚI THIỆU > 1. GIỚI THIỆU CHUNG > Chặng đường lịch sử — Trang 6–7`;

        const userPrompt = `<context>
${contextText}
</context>

**Câu hỏi:** ${input}

Yêu cầu: Trả lời dựa hoàn toàn vào <context> trên. Sau mỗi thông tin quan trọng, ghi rõ nguồn theo định dạng *(Nguồn: [breadcrumb] — [trang])*.`;

        const response = await deepseek.chat.completions.create({
            model: "deepseek-chat",
            max_tokens: 1024,
            temperature: 0.1,
            messages: [
                { role: "system", content: systemPrompt },
                ...conversation.messages.slice(-20).map((msg) => ({
                    role: msg.role,
                    content: msg.content,
                })),
                { role: "user", content: userPrompt },
            ],
        });

        const answer = response.choices[0].message.content.trim();

        // Lưu message assistant + cập nhật lastActiveAt
        conversation.messages.push({ role: "assistant", content: answer });
        conversation.lastActiveAt = new Date();
        await conversation.save();

        return res.status(200).json({
            status: "success",
            question: input,
            answer,
        });
    } catch (err) {
        console.error("[chat] Error:", err.message);
        try {
            if (req.user?.id) {
                const conversation = await ConversationModel.findOne({ userId: req.user.id });
                if (conversation) {
                    conversation.messages.push({
                        role: "assistant",
                        content: "Đã có lỗi xảy ra, vui lòng thử lại sau!",
                    });
                    conversation.lastActiveAt = new Date();
                    await conversation.save();
                }
            }
        } catch (_) { }

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
        let conversation = await ConversationModel.findOne({ userId });

        if (!conversation) {
            conversation = await ConversationModel.create({
                userId,
                messages: [
                    {
                        role: "assistant",
                        content: "Xin chào! Tôi là trợ lý tư vấn sinh viên khóa 63 của Trường Đại học Giao thông vận tải (UTC). Tôi có thể giúp bạn tra cứu thông tin trong Sổ tay sinh viên dành cho sinh viên khóa 63 hệ chính quy. Bạn cần hỗ trợ gì không?",
                    },
                ],
            });
        }

        return res.status(200).json({
            status: "success",
            conversation: conversation.messages,
        });
    } catch (err) {
        console.error("[getChatHistory] Error:", err.message);
        return res.status(500).json({
            status: "error",
            message: "Internal server error",
            error: err.message,
        });
    }
};

exports.clearChatHistory = async (req, res) => {
    try {
        const userId = req.user.id;
        await ConversationModel.updateOne(
            { userId },
            {
                $set: {
                    messages: [
                        {
                            role: "assistant",
                            content: "Xin chào! Tôi là trợ lý tư vấn sinh viên khóa 63 của Trường Đại học Giao thông vận tải (UTC). Tôi có thể giúp bạn tra cứu thông tin trong Sổ tay sinh viên dành cho sinh viên khóa 63 hệ chính quy. Bạn cần hỗ trợ gì không?",
                        },
                    ],
                    lastActiveAt: new Date(),
                },
            }
        );
        return res.status(200).json(
            {
                status: "success",
                message: "Chat history cleared"
            });
    } catch (err) {
        console.error("[clearChatHistory] Error:", err.message);
        return res.status(500).json({
            status: "error",
            message: "Internal server error",
            error: err.message
        });
    }
};
exports.insertData = async (req, res) => {
    try {
        //  STEP 1: Chuẩn bị MongoDB 
        console.log("[insertData] STEP 1: Chuẩn bị MongoDB...");
        const database = mongoClient.db("SoTaySinhVien");
        const collection = database.collection("chunks");

        // Xóa data cũ MongoDB
        await collection.deleteMany({});
        console.log("[insertData] Đã xóa data cũ MongoDB");

        //  STEP 2: Xóa data cũ Elasticsearch 
        console.log("[insertData] STEP 2: Xóa data cũ Elasticsearch...");
        const indexExists = await elasticClient.indices.exists({ index: "sotaysinhvien" });
        if (indexExists) {
            await elasticClient.deleteByQuery({
                index: "sotaysinhvien",
                query: { match_all: {} },
            });
            await elasticClient.indices.refresh({ index: "sotaysinhvien" });
            console.log("[insertData] Đã xóa data cũ Elasticsearch");
        }

        //  STEP 3: Convert chunks.json → LangChain Document format 
        console.log("[insertData] STEP 3: Convert chunks sang Document format...");
        const documents = chunks.map((chunk) => ({
            pageContent: chunk.content,
            metadata: {
                chunk_id: chunk.chunk_id,
                page: chunk.page,
            },
        }));
        console.log(`[insertData] → ${documents.length} documents sẵn sàng`);

        //  STEP 4: Insert vào MongoDB Atlas Vector Search (theo batch) 
        console.log("[insertData] STEP 4: Insert vào MongoDB...");
        const BATCH_SIZE = 10;
        for (let i = 0; i < documents.length; i += BATCH_SIZE) {
            const batch = documents.slice(i, i + BATCH_SIZE);
            console.log(`[insertData] Inserting batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(documents.length / BATCH_SIZE)}`);
            await MongoDBAtlasVectorSearch.fromDocuments(batch, embeddingModel, {
                collection,
                indexName: "autoembed_index",
                textKey: "text",
                embeddingKey: "embedding",
            });
        }
        console.log("[insertData] MongoDB done");

        //  STEP 5: Index vào Elasticsearch 
        console.log("[insertData] STEP 5: Index vào Elasticsearch...");
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
        console.log("[insertData] Elasticsearch done");

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