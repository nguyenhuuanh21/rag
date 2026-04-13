const express = require("express");
const router = express.Router();
const uploadMiddleware = require("../apps/middlewares/upload");
const cloudinary = require("cloudinary").v2;
const dotenv = require("dotenv");
const fs = require("fs");
// Thêm thư viện MongoDB và LangChain MongoDB
const { MongoClient } = require("mongodb");
const { MongoDBAtlasVectorSearch } = require("@langchain/mongodb");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { OllamaEmbeddings,ChatOllama } = require("@langchain/ollama");
dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const client = new MongoClient(process.env.MONGODB_URI);
const embeddings = new OllamaEmbeddings({
  model: "nomic-embed-text",
  baseUrl: "http://localhost:11434",
});

const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 250,
  chunkOverlap: 50,
});


router.post("/", uploadMiddleware.single("file"), async (req, res) => {
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
      const loader = new PDFLoader(file.path);
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
      await client.connect();
      const database = client.db("rag_app");
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
      message: "Error uploading file",
      error: err.message,
    });
  }
});
router.post("/chat", async (req, res) => {
  try {
    const { input } = req.body;
    if (!input) {
      return res.status(400).json({
        status: "error",
        message: "Input query is required",
      });
    }
    await client.connect();
    const database = client.db("rag_app"); // Tên DB của bạn
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
    const llm = new ChatOllama({
      model: "qwen2.5:3b", // Tên model chat bạn đang dùng (có thể đổi thành qwen2, mistral...)
      baseUrl: "http://localhost:11434",
      temperature: 0.2, // Để thấp để AI trả lời bám sát tài liệu, không bịaa chuyện
    });
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
    })
  }
})
module.exports = router;
