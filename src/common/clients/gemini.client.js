const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");

const embeddingModel = new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GEMINI_API_KEY,
    model: "gemini-embedding-001",
    taskType: "RETRIEVAL_DOCUMENT",
});

module.exports = embeddingModel; 