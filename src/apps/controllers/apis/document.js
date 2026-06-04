const mongoose = require('mongoose');
const { mongoClient } = require("../../../common/connections/mongo.connection");
const elasticClient = require("../../../common/connections/elasticsearch.connection");
const redisClient = require("../../../common/connections/redis.connection");
const { MongoDBAtlasVectorSearch } = require("@langchain/mongodb");
const ConversationModel = require("../../models/conversation");
const embeddingModel = require("../../../common/clients/gemini.client");
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
    const session = await mongoose.startSession();
    let uploadedCloudinaryFile = null;
    try {
        session.startTransaction();
        const { body, file } = req;
        
        if (!file) {
            await session.abortTransaction();
            return res.status(400).json({ status: "error", message: "File không được để trống" });
        }
        const pdfPath = file.path;

        // Dùng session với Mongoose Model
        const isNameExist = await documentModel.findOne({ name: body.name }).session(session);
        if (isNameExist) {
            await session.abortTransaction();
            return res.status(400).json({ status: "error", message: "Tên tài liệu đã tồn tại, vui lòng chọn tên khác" });
        }

        uploadedCloudinaryFile = await cloudinary.uploader.upload(pdfPath, {
            folder: "pdfs",
            resource_type: "auto",
            secure: true,
        });

        const [document] = await documentModel.create([{
            name: body.name,
            cloudinary_link: uploadedCloudinaryFile.secure_url,
        }], { session });

        const scriptPath = path.join(__dirname, '../../../python_scripts/chunk.py');
        const pythonCmd = process.platform === "win32" ? "python" : "python3";

        const { stdout, stderr } = await execFileAsync(pythonCmd, [scriptPath, pdfPath], {
            maxBuffer: 1024 * 1024 * 50
        });

        const startIndex = stdout.indexOf('[');
        if (startIndex === -1) {
            throw new Error("Không tìm thấy mảng JSON trong kết quả trả về từ Python");
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
        const BATCH_SIZE = 10;
        const nativeCollection = mongoose.connection.collection('chunks');

        for (let i = 0; i < documents.length; i += BATCH_SIZE) {
            const batch = documents.slice(i, i + BATCH_SIZE);
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(documents.length / BATCH_SIZE);
            console.log(`[insertData] MongoDB batch ${batchNum}/${totalBatches}`);

            const textsToEmbed = batch.map(doc => doc.pageContent);
            const embeddings = await embeddingModel.embedDocuments(textsToEmbed);

            const mongoDocs = batch.map((doc, index) => ({
                document_id: doc.metadata.document_id,
                chunk_id: doc.metadata.chunk_id,
                text: doc.pageContent,
                embedding: embeddings[index]
            }));

            await nativeCollection.insertMany(mongoDocs, { session });
        }
        console.log("[insertData] MongoDB done");
        for (const doc of documents) {
            await elasticClient.index({
                index: "sotay",
                document: { content: doc.pageContent, metadata: doc.metadata },
            });
        }
        await elasticClient.indices.refresh({ index: "sotay" });
        await session.commitTransaction();
        return res.status(200).json({
            status: "success",
            message: "Upload và trích xuất thành công!",
            document: document,
            total_chunks: chunksArray.length
        });
    } catch (err) {
        console.error("[indexing] Error:", err.message);
        await session.abortTransaction();
        if (uploadedCloudinaryFile && uploadedCloudinaryFile.public_id) {
            try {
                await cloudinary.uploader.destroy(uploadedCloudinaryFile.public_id);
                console.log("[Rollback] Đã xóa file trên Cloudinary do lỗi hệ thống");
            } catch (cloudErr) {
                console.error("[Rollback Failed] Không thể xóa file Cloudinary:", cloudErr.message);
            }
        }
        return res.status(500).json({ 
            status: "error", 
            message: "Lưu file thành công nhưng trích xuất Chunk thất bại", 
            error: err.message 
        });

    } finally {
        await session.endSession();
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
    const session = mongoClient.startSession();
    try {
        session.startTransaction();
        const { id } = req.body;
        const document = await documentModel.findById(id).session(session);
        if (!document) {
            return res.status(404).json({ status: "error", message: "Document not found" });
        }
        await _collection.deleteMany({ "document_id": id }, { session });
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
        await documentModel.findByIdAndDelete(id).session(session);
        await ChatModel.deleteMany({ documentId: id }, { session });
        await session.commitTransaction();
        return res.status(200).json({
            status: "success",
            message: "Đã xóa tài liệu và các dữ liệu liên quan thành công"
        });
    } catch (err) {
        console.error("[deleteDocument] Error:", err.message);
        await session.abortTransaction();
        return res.status(500).json({ status: "error", error: err.message, message: "Internal server error" });
    } finally {
        await session.endSession();
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
    const session = mongoClient.startSession();
    try {
        session.startTransaction();
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
            },
            { session }
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
        await session.commitTransaction();
        return res.status(200).json({
            status: "success",
            message: "Đã cập nhật chunk thành công"
        });
    } catch (err) {
        await session.abortTransaction();
        return res.status(500).json({ status: "error", error: err.message, message: "Internal server error" });
    } finally {
        await session.endSession();
    }
}
//xong
exports.deleteChunk = async (req, res) => {
    const session = mongoClient.startSession();
    try {
        session.startTransaction();
        const { documentId, chunkId } = req.params;
        console.log(`[deleteChunk] documentId: ${documentId}, chunkId: ${chunkId}`);
        // Xóa khỏi MongoDB Vector Store
        const mongoResult = await _collection.deleteOne({
            "document_id": documentId,
            "chunk_id": Number(chunkId)
        }, { session });

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
        await session.commitTransaction();
        return res.status(200).json({
            status: "success",
            message: "Đã xóa chunk thành công",
        })
    } catch (err) {
        console.error(err);
        await session.abortTransaction();
        return res.status(500).json({
            status: "error",
            message: "Internal server error",
            error: err.message
        });
    } finally {
        await session.endSession();
    }
};
exports.addChunk = async (req, res) => {
    const session = mongoClient.startSession();
    try {
        session.startTransaction();
        const { documentId } = req.params;
        const { content } = req.body;
        const [embedding] = await embeddingModel.embedDocuments([content]);
        const lastChunk = await _collection
            .find({ "document_id": documentId }, { session })
            .sort({ chunk_id: -1 })
            .limit(1)
            .toArray();

        const newChunkId = lastChunk.length > 0 ? lastChunk[0].chunk_id + 1 : 0;

        const newChunkData = {
            "document_id": documentId,
            "chunk_id": newChunkId,
            "text": content,
            "embedding": embedding
        };

        // 2. Thực hiện insert
        const result = await _collection.insertOne(newChunkData, { session });

        // 4. Lưu vào Elasticsearch
        await elasticClient.index({
            index: "sotay",
            document: {
                content: content,
                metadata: {
                    document_id: documentId,
                    chunk_id: newChunkId
                }
            }
        });

        await session.commitTransaction();
        const chunkResponse = {
            _id: result.insertedId,
            ...newChunkData
        };
        return res.status(200).json({ status: "success", message: "Thêm chunk thành công", data: chunkResponse });
    } catch (err) {
        await session.abortTransaction();
        return res.status(500).json({ status: "error", error: err.message, message: "Internal server error" });
    } finally {
        await session.endSession();
    }
}