const cloudinary = require("../../../common/init.cloudinary")
const textSplitter = require("../../../libs/textSplitter");
const embeddings = require("../../../common/init.embedding");
const mongoClient = require("../../../common/init.mongo");
const neo4jClient = require("../../../common/init.neo4j");
const elasticClient = require("../../../common/init.elasticsearch");
const llm = require("../../../common/init.qwen-3b");// Thêm thư viện MongoDB và LangChain MongoDB
const { MongoDBAtlasVectorSearch } = require("@langchain/mongodb");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const { PromptTemplate } = require("@langchain/core/prompts");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { Document } = require("@langchain/core/documents");
const { semanticChunker } = require("../../../libs/semanticChunk");
const getReranker = require("../../../common/reranker");
const { v4: uuidv4 } = require('uuid');
const fs = require("fs");
const getPdfJs = async () => {
    const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
    return {
        getDocument: mod.getDocument,
        version: mod.version,
    };
};
const logMemory = (label) => {
    const used = process.memoryUsage();
    console.log(`\n📊 ${label}`);
    console.log(`RSS: ${(used.rss / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Heap Used: ${(used.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Heap Total: ${(used.heapTotal / 1024 / 1024).toFixed(2)} MB`);
};
exports.hybrid = async (req, res) => {
    const { file } = req;

    if (!file) {
        console.log("[upload] No file uploaded");
        return res.status(400).json({
            status: "error",
            message: "No file uploaded",
        });
    }

    // Track uploaded resources for rollback
    let cloudinaryPublicId = null;
    let mongoInserted = false;
    let elasticIndexed = false;
    let elasticDocIds = [];

    try {
        // ─── STEP 1: Upload lên Cloudinary ───────────────────────────────────
        const pdf = await cloudinary.uploader.upload(file.path, {
            folder: "pdfs",
            resource_type: "auto",
            public_id: uuidv4(),
            secure: true,
        });
        logMemory("AFTER CLOUDINARY");
        cloudinaryPublicId = pdf.public_id;

        // ─── STEP 2: Load & split PDF ─────────────────────────────────────────
        const loader = new PDFLoader(file.path, { pdfjs: getPdfJs });
        console.log('file.path:', file.path);
        const docs = await loader.load();
        logMemory("AFTER LOAD PDF");

        const splitDocs = await textSplitter.splitDocuments(docs);
logMemory("AFTER SPLIT");
        // ─── STEP 3: Gắn metadata ─────────────────────────────────────────────
        const docsWithMetadata = splitDocs.map(doc => ({
            ...doc,
            metadata: {
                ...doc.metadata,
                cloudinary_url: pdf.secure_url,
                cloudinary_id: pdf.public_id,
            },
        }));
        logMemory("AFTER METADATA");
        const semanticChunks = await semanticChunker(docsWithMetadata);
logMemory("AFTER SEMANTIC CHUNK");
        // ─── STEP 4: Lưu vào MongoDB Atlas Vector Search ─────────────────────
        const database = mongoClient.db("rag_app");
        const collection = database.collection("pdf_vectors");

        await MongoDBAtlasVectorSearch.fromDocuments(semanticChunks, embeddings, {
            collection,
            indexName: "vector_index",
            textKey: "text",
            embeddingKey: "embedding",
        });
        logMemory("AFTER MONGO");
        mongoInserted = true;

        // ─── STEP 5: Index vào Elasticsearch ─────────────────────────────────
        for (const doc of semanticChunks) {
            const result = await elasticClient.index({
                index: "pdf_chunks",
                document: {
                    content: doc.pageContent,
                    metadata: doc.metadata,
                },
            });
            elasticDocIds.push(result._id);
        }
        await elasticClient.indices.refresh({ index: "pdf_chunks" });
        logMemory("AFTER ELASTIC");
        elasticIndexed = true;

        // ─── STEP 6: Dọn file tạm ────────────────────────────────────────────
        fs.unlinkSync(file.path);

        return res.status(200).json({
            status: "success",
            message: "File uploaded and indexed successfully",
            file: pdf,
            chunks: splitDocs.length,
        });

    } catch (err) {
        console.error("[upload] Error:", err.message);

        // ── ROLLBACK ──────────────────────────────────────────────────────────
        const rollbackErrors = [];

        // Rollback Elasticsearch
        if (elasticDocIds.length > 0) {
            try {
                await Promise.all(
                    elasticDocIds.map(id =>
                        elasticClient.delete({ index: "pdf_chunks", id })
                    )
                );
            } catch (e) {
                rollbackErrors.push(`Elasticsearch rollback failed: ${e.message}`);
            }
        }

        // Rollback MongoDB (xoá các doc có cùng cloudinary_id)
        if (mongoInserted && cloudinaryPublicId) {
            try {
                const database = mongoClient.db("rag_app");
                const collection = database.collection("pdf_vectors");
                await collection.deleteMany({
                    "metadata.cloudinary_id": cloudinaryPublicId,
                });
            } catch (e) {
                rollbackErrors.push(`MongoDB rollback failed: ${e.message}`);
            }
        }

        // Rollback Cloudinary
        if (cloudinaryPublicId) {
            try {
                await cloudinary.uploader.destroy(cloudinaryPublicId, {
                    resource_type: "raw",
                });
            } catch (e) {
                rollbackErrors.push(`Cloudinary rollback failed: ${e.message}`);
            }
        }

        // Dọn file tạm nếu còn
        try {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        } catch (_) { }

        return res.status(500).json({
            status: "error",
            message: "Upload failed. All changes have been rolled back.",
            error: err.message,
            ...(rollbackErrors.length > 0 && { rollback_warnings: rollbackErrors }),
        });
    }
};
exports.upload = async (req, res) => {
    try {
        const { body, file } = req;
        if (file) {
            const pdf = await cloudinary.uploader.upload(file.path, {
                folder: "pdfs",
                resource_type: "auto",
                public_id: uuidv4(),
                secure: true,
            });

            // 2. Load PDF
            const loader = new PDFLoader(file.path, { pdfjs: getPdfJs });
            const docs = await loader.load();

            // 3. Chia nhỏ văn bản
            const splitDocs = await textSplitter.splitDocuments(docs);

            // Thêm metadata
            const docsWithMetadata = splitDocs.map(doc => {
                doc.metadata = {
                    ...doc.metadata,
                    cloudinary_url: pdf.secure_url,
                    cloudinary_id: pdf.public_id
                };
                return doc;
            });
            // 4. Chunk ngữ nghĩa
            const semanticChunks = await semanticChunker(docsWithMetadata);
            const database = mongoClient.db("rag_app");
            const collection = database.collection("pdf_vectors");
            await MongoDBAtlasVectorSearch.fromDocuments(semanticChunks, embeddings, {
                collection: collection,
                indexName: "vector_index", // Tên index bạn đã tạo trên Atlas UI ở bước 2
                textKey: "text", // Trường lưu trữ text gốc (mặc định)
                embeddingKey: "embedding", // Trường lưu trữ vector (mặc định)
            });
            fs.unlinkSync(file.path);
            return res.status(200).json({
                message: "File uploaded successfully",
                file: pdf,
                chunk: semanticChunks.length,
            });
        }
        return res.status(400).json({
            status: "error",
            message: "No file uploaded",
        });
    } catch (err) {
        return res.status(500).json({
            status: "error",
            message: "Internal server error",
            error: err.message,
        });
    }
}
exports.chat = async (req, res) => {
    try {
        const { input } = req.body;
        if (!input) {
            return res.status(400).json({
                status: "error",
                message: "Input query is required",
            });
        }
        const database = mongoClient.db("rag_app"); // Tên DB của bạn
        const collection = database.collection("pdf_vectors"); // Tên collection của bạn
        const vectorStore = new MongoDBAtlasVectorSearch(embeddings, {
            collection: collection,
            indexName: "vector_index", // Tên Index bạn đã tạo trên Atlas
            textKey: "text",
            embeddingKey: "embedding",
        });
        const searchResults = await vectorStore.similaritySearch(input, 3);
        if (searchResults.length === 0) {
            return res.status(200).json({
                answer: "Tôi không tìm thấy thông tin nào liên quan đến câu hỏi của bạn trong tài liệu.",
            });
        }
        const contextText = searchResults.map(doc => doc.pageContent).join("\n\n---\n\n");
        const prompt = `
Bạn là một trợ lý ảo thông minh. Hãy trả lời câu hỏi của người dùng dựa trên NGỮ CẢNH được cung cấp bên dưới. 
Nếu thông tin trong ngữ cảnh không đủ để trả lời, hãy nói "Tôi không tìm thấy thông tin trong tài liệu", tuyệt đối không tự bịa ra câu trả lời.

NGỮ CẢNH:
${contextText}

CÂU HỎI CỦA NGƯỜI DÙNG:
${input}

CÂU TRẢ LỜI CỦA BẠN:`;
        const aiResponse = await llm.invoke(prompt);

        return res.status(200).json({
            status: "success",
            question: input,
            answer: aiResponse,
        })
    } catch (err) {
        return res.status(500).json({
            status: "error",
            message: "Internal server error",
            error: err.message,
        });
    }
}

// exports.uploadToElastic = async (req, res) => {
//     try {
//         const { body, file } = req;
//         if (!file) {
//             return res.status(400).json({
//                 status: "error",
//                 message: "No file uploaded",
//             });
//         }
//         const pdf = await cloudinary.uploader.upload(file.path, {
//             folder: "pdfs",
//             resource_type: "auto",
//             use_filename: true,
//             unique_filename: false,
//             secure: true,
//         });
//         // 2. Load PDF
//         const loader = new PDFLoader(file.path, { pdfjs: getPdfJs });
//         const docs = await loader.load();

//         // 3. Chia nhỏ văn bản
//         const splitDocs = await textSplitter.splitDocuments(docs);
//         const semanticChunks = await semanticChunker(splitDocs);

//         // Thêm metadata
//         const docsWithMetadata = semanticChunks.map(doc => {
//             doc.metadata = {
//                 ...doc.metadata,
//                 cloudinary_url: pdf.secure_url,
//                 source_file: file.originalname
//             };
//             return doc;
//         });
//         for (const doc of docsWithMetadata) {
//             await elasticClient.index({
//                 index: 'pdf_chunks',
//                 document: {
//                     content: doc.pageContent,
//                     metadata: doc.metadata
//                 }
//             });
//         }

//         await elasticClient.indices.refresh({ index: 'pdf_chunks' });
//         return res.json({
//             status: "success",
//             message: "Uploaded and indexed successfully",
//             total: docsWithMetadata.length
//         });
//     } catch (err) {
//         return res.status(500).json({
//             status: "error",
//             message: "Internal server error",
//             error: err.message,
//         })
//     }

// }
exports.chatElastic = async (req, res) => {
    try {
        const { input } = req.body;
        if (!input) {
            return res.status(400).json({
                status: "error",
                message: "Input query is required",
            });
        }
        const result = await elasticClient.search({
            index: "pdf_chunks",
            size: 5,
            query: {
                match: {
                    content: {
                        query: input,
                        operator: "or"
                    }
                }
            }
        });
        const hits = result.hits.hits;

        const response = hits.map(item => ({
            score: item._score,        // 🔥 điểm BM25
            content: item._source.content,
            metadata: item._source.metadata
        }));
        return res.status(200).json({
            status: "success",
            query: input,
            total: hits.length,
            results: response
        });
    } catch (err) {
        return res.status(500).json({
            status: "error",
            message: "Internal server error",
            error: err.message,
        })
    }
}
exports.testReranker = async (req, res) => {
    try {
        const { tokenizer, model } = await getReranker();

        const query = "Học máy là gì?";
        const documents = [
            "Học máy là một nhánh của trí tuệ nhân tạo.",
            "Hôm nay thời tiết rất đẹp.",
            "Deep learning là kỹ thuật học sâu trong AI.",
            "Bóng đá là môn thể thao phổ biến.",
        ];

        // tokenize batch (chuẩn CrossEncoder)
        const inputs = await tokenizer(
            documents.map(() => query),
            {
                text_pair: documents,
                padding: true,
                truncation: true,
                return_tensors: "pt",
            }
        );

        // forward model
        const { logits } = await model(inputs);

        // convert sang array JS
        const rawScores = logits.tolist().map((s) => s[0]);

        // sort
        const ranked = documents
            .map((doc, i) => ({
                text: doc,
                score: rawScores[i],
            }))
            .sort((a, b) => b.score - a.score);

        console.log("Kết quả rerank:");
        ranked.forEach((r, i) =>
            console.log(`${i + 1}. [${r.score.toFixed(4)}] ${r.text}`)
        );

        return res.status(200).json({
            status: "success",
            query,
            total: ranked.length,
            results: ranked,
        });
    } catch (err) {
        console.error(err);

        return res.status(500).json({
            status: "error",
            message: "Internal server error",
            error: err.message,
        });
    }
}
exports.testSemanticChunk = async (req, res) => {
    try {
        const text = `Học máy là một lĩnh vực quan trọng trong trí tuệ nhân tạo. Nó cho phép máy tính học từ dữ liệu mà không cần được lập trình rõ ràng! Bạn có bao giờ tự hỏi tại sao các hệ thống gợi ý lại hiểu bạn tốt như vậy? Ví dụ, khi bạn xem phim trên Netflix hoặc nghe nhạc trên Spotify, hệ thống sẽ phân tích hành vi của bạn và đưa ra đề xuất phù hợp. (Điều này dựa trên các mô hình học máy hiện đại.)

Trong thực tế, học máy được ứng dụng trong rất nhiều lĩnh vực khác nhau. Từ nhận diện khuôn mặt, xử lý ngôn ngữ tự nhiên, cho đến xe tự lái và y tế. Tuy nhiên, không phải lúc nào mô hình cũng hoạt động hoàn hảo. Đôi khi dữ liệu bị nhiễu hoặc không đầy đủ, dẫn đến kết quả sai lệch. Điều này đặt ra nhiều thách thức cho các nhà nghiên cứu và kỹ sư.

Ngoài ra, deep learning là một nhánh con của học máy, tập trung vào các mạng nơ-ron nhiều lớp. Những mô hình này có thể xử lý dữ liệu phức tạp như hình ảnh, âm thanh và văn bản. Tuy nhiên, chúng cũng yêu cầu tài nguyên tính toán rất lớn. (Ví dụ như GPU hoặc TPU mạnh mẽ.) Vì vậy, việc tối ưu hóa mô hình là rất quan trọng.

Cuối cùng, tương lai của học máy vẫn đang phát triển rất nhanh. Nhiều công nghệ mới đang được nghiên cứu và áp dụng. Bạn nghĩ điều gì sẽ xảy ra trong 10 năm tới? Liệu AI có thể thay thế con người trong nhiều công việc hay không? Đây vẫn là một câu hỏi mở.`
        const docs = [
            new Document({
                pageContent: text,
                metadata: { page: 1 }
            })
        ];
        const chunks = await textSplitter.splitDocuments(docs);
        const semanticChunks = await semanticChunker(chunks);

        return res.status(200).json({
            status: "success",
            chunk: chunks.map(c => ({

                content: c.pageContent,
                metadata: {
                    page: c.metadata.loc.pageNumber,
                    from: c.metadata.loc.lines.from,
                    to: c.metadata.loc.lines.to,
                }

            })),
            chunkSemantic: semanticChunks.map((chunk, idx) => ({
                content: chunk.pageContent,
                metadata: {
                    page_ranges: chunk.metadata.page_ranges,
                    chunk_size: chunk.metadata.chunk_size,
                }
            }))
        });
    } catch (err) {
        return res.status(500).json({
            status: "error",
            message: "Internal server error",
            error: err.message,
        });
    }
}