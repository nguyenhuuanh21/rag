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
const { semanticChunker } = require("../../../libs/semanticChunk");
const getReranker = require("../../../common/reranker");
const fs = require("fs");
const getPdfJs = async () => {
    const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
    return {
        getDocument: mod.getDocument,
        version: mod.version,
    };
};
exports.upload = async (req, res) => {
    try {
        const { body, file } = req;
        if (file) {
            const pdf = await cloudinary.uploader.upload(file.path, {
                folder: "pdfs",
                resource_type: "auto",
                use_filename: true,
                unique_filename: false,
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
                    source_file: file.originalname
                };
                return doc;
            });
            const database = mongoClient.db("rag_app");
            const collection = database.collection("pdf_vectors");
            await MongoDBAtlasVectorSearch.fromDocuments(docsWithMetadata, embeddings, {
                collection: collection,
                indexName: "vector_index", // Tên index bạn đã tạo trên Atlas UI ở bước 2
                textKey: "text", // Trường lưu trữ text gốc (mặc định)
                embeddingKey: "embedding", // Trường lưu trữ vector (mặc định)
            });
            fs.unlinkSync(file.path);
            return res.status(200).json({
                message: "File uploaded successfully",
                file: pdf,
                chunk: splitDocs.length,
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

exports.uploadToElastic = async (req, res) => {
    try {
        const { body, file } = req;
        if (!file) {
            return res.status(400).json({
                status: "error",
                message: "No file uploaded",
            });
        }
        const pdf = await cloudinary.uploader.upload(file.path, {
            folder: "pdfs",
            resource_type: "auto",
            use_filename: true,
            unique_filename: false,
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
                source_file: file.originalname
            };
            return doc;
        });
        for (const doc of docsWithMetadata) {
            await elasticClient.index({
                index: 'pdf_chunks',
                document: {
                    content: doc.pageContent,
                    metadata: doc.metadata
                }
            });
        }

        await elasticClient.indices.refresh({ index: 'pdf_chunks' });
        return res.json({
            status: "success",
            message: "Uploaded and indexed successfully",
            total: docsWithMetadata.length
        });
    } catch (err) {
        return res.status(500).json({
            status: "error",
            message: "Internal server error",
            error: err.message,
        })
    }

}
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
        const chunks = await semanticChunker(text);
        return res.status(200).json({
            status: "success",
            chunks
        });
    } catch (err) {
        return res.status(500).json({
            status: "error",
            message: "Internal server error",
            error: err.message,
        });
    }
}