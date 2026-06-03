
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
const documentModel = require("../../models/document.js");
const ChatModel = require("../../models/chat.js");
const cloudinary = require("../../../common/clients/cloudinary");
const fs = require("fs");
const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);
const path = require('path');


const _db = mongoClient.db("SoTaySinhVien");
const _collection = _db.collection("chunks");
const vectorStore = new MongoDBAtlasVectorSearch(embeddingModel, {
    collection: _collection,
    indexName: "autoembed_index",
    textKey: "text",
    embeddingKey: "embedding",
});
exports.indexing = async (req, res) => {
    try {
        const { body, file } = req;
        // 1. Kiểm tra file đầu vào
        if (!file) {
            return res.status(400).json({ status: "error", message: "File không được để trống" });
        }
        const pdfPath = file.path;
        // 2. Kiểm tra trùng lặp tên tài liệu
        const isNameExist = await documentModel.findOne({ name: body.name });
        if (isNameExist) {
            return res.status(400).json({ status: "error", message: "Tên tài liệu đã tồn tại, vui lòng chọn tên khác" });
        }
        // 3. Upload lên Cloudinary
        const pdf = await cloudinary.uploader.upload(pdfPath, {
            folder: "pdfs",
            resource_type: "auto",
            secure: true,
        });
        // 4. Lưu thông tin vào Database
        const document = await documentModel.create({
            name: body.name,
            cloudinary_link: pdf.secure_url,
        });
        // 5. Gọi Python xử lý Chunking
        const scriptPath = path.join(__dirname, '../../../python_scripts/chunk.py');
        try {
            const pythonCmd =
                process.platform === "win32"
                    ? "python"
                    : "python3";

            const { stdout, stderr } = await execFileAsync(
                pythonCmd,
                [scriptPath, pdfPath],
                {
                    maxBuffer: 1024 * 1024 * 50
                }
            );
            const startIndex = stdout.indexOf('[');
            if (startIndex === -1) {
                throw new Error("Không tìm thấy mảng JSON trong kết quả trả về");
            }
            const cleanJsonString = stdout.substring(startIndex);
            const chunksArray = JSON.parse(cleanJsonString);
            console.log(`Đã trích xuất thành công ${chunksArray.length} chunks!`);

            const documents = chunksArray.map((chunk) => ({
                pageContent: chunk.content,
                metadata: {
                    document_id: document._id.toString(),
                    chunk_id: chunk.chunk_id,
                },
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
                    index: "sotay",
                    document: { content: doc.pageContent, metadata: doc.metadata },
                });
            }
            await elasticClient.indices.refresh({ index: "sotay" });

            return res.status(200).json({
                status: "success",
                message: "Upload và trích xuất thành công!",
                document: document,
                total_chunks: chunksArray.length
            });

        } catch (pythonError) {
            console.error("Lỗi chạy Python hoặc Parse JSON:", pythonError);
            return res.status(500).json({
                status: "error",
                message: "Lưu file thành công nhưng trích xuất Chunk thất bại",
                error: pythonError.message
            });
        }
    } catch (err) {
        console.error("[indexing] Error:", err.message);
        return res.status(500).json({ status: "error", message: "Internal server error" });
    } finally {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
    }
};
//xong
exports.getDocuments = async (req, res) => {
    try {
        const documents = await documentModel.find().sort({ createdAt: -1 });
        return res.status(200).json({ status: "success", total: documents.length, documents });
    } catch (err) {
        console.error("[getDocuments] Error:", err.message);
        return res.status(500).json({ status: "error", message: "Internal server error" });
    }
}
//xong
exports.deleteDocument = async (req, res) => {
    try {
        const { id } = req.body;
        const document = await documentModel.findById(id);
        if (!document) {
            return res.status(404).json({ status: "error", message: "Document not found" });
        }

        await _collection.deleteMany({ "document_id": id });
        console.log(`[deleteDocument] Đã xóa chunks của document ${id} trong MongoDB`);

        const indexExists = await elasticClient.indices.exists({ index: "sotay" });
        if (indexExists) {
            await elasticClient.deleteByQuery({
                index: "sotay",
                query: {
                    term: {
                        "metadata.document_id.keyword": id
                    }
                }
            });
            await elasticClient.indices.refresh({ index: "sotay" });
            console.log(`[deleteDocument] Đã xóa chunks của document ${id} trong Elasticsearch`);
        }

        await documentModel.findByIdAndDelete(id);
        await ChatModel.deleteMany({ documentId: id });
        return res.status(200).json({
            status: "success",
            message: "Đã xóa tài liệu và các dữ liệu liên quan thành công"
        });
    } catch (err) {
        console.error("[deleteDocument] Error:", err.message);
        return res.status(500).json({ status: "error", message: "Internal server error" });
    }
};
//xong
exports.updateDocument = async (req, res) => {
    try {
        const { id, name } = req.body;
        const document = await documentModel.findById(id);
        if (!document) {
            return res.status(404).json({ status: "error", message: "Document not found" });
        }
        document.name = name;
        await document.save();
        return res.status(200).json({
            status: "success",
            message: "Đã cập nhật tài liệu thành công",
            document
        });
    } catch (err) {
        console.error("[updateDocument] Error:", err.message);
        return res.status(500).json({ status: "error", message: "Internal server error" });
    }
}
//xong
exports.getChunksByDocument = async (req, res) => {
    try {
        const { documentId } = req.params;
        const chunks = await _collection.find({ "document_id": documentId }).toArray();
        return res.status(200).json({
            status: "success",
            total: chunks.length,
            chunks
        });
    } catch (err) {
        return res.status(500).json({ status: "error", error: err.message, message: "Internal server error" });
    }
}
//xong
exports.updateChunk = async (req, res) => {
    try {
        const { documentId, chunkId } = req.params;
        const { content } = req.body;
        const [embedding] = await embeddingModel.embedDocuments([content]);
        await _collection.updateOne(
            { "document_id": documentId, "chunk_id": Number(chunkId) },
            {
                $set: {
                    text: content,
                    embedding: embedding
                }
            }
        );
        await elasticClient.updateByQuery({
            index: "sotay",
            query: {
                bool: {
                    filter: [
                        {
                            term: {
                                "metadata.document_id.keyword": documentId
                            }
                        },
                        {
                            term: {
                                "metadata.chunk_id": Number(chunkId)
                            }
                        }
                    ]
                }
            },
            script: {
                source: `
            ctx._source.content = params.content;
        `,
                params: {
                    content: content
                }
            }
        });
        return res.status(200).json({
            status: "success",
            message: "Đã cập nhật chunk thành công"
        });
    } catch (err) {
        return res.status(500).json({ status: "error", error: err.message, message: "Internal server error" });
    }
}
//xong
exports.deleteChunk = async (req, res) => {
    try {
        const { documentId, chunkId } = req.params;
        console.log(`[deleteChunk] documentId: ${documentId}, chunkId: ${chunkId}`);
        // Xóa khỏi MongoDB Vector Store
        const mongoResult = await _collection.deleteOne({
            "document_id": documentId,
            "chunk_id": Number(chunkId)
        });

        // Xóa khỏi Elasticsearch
        await elasticClient.deleteByQuery({
            index: "sotay",
            query: {
                bool: {
                    filter: [
                        {
                            term: {
                                "metadata.document_id.keyword": documentId
                            }
                        },
                        {
                            term: {
                                "metadata.chunk_id": Number(chunkId)
                            }
                        }
                    ]
                }
            }
        });

        return res.status(200).json({
            status: "success",
            message: "Đã xóa chunk thành công",
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            status: "error",
            message: "Internal server error",
            error: err.message
        });
    }
};