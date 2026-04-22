const { OllamaEmbeddings } = require("@langchain/ollama");
const embeddings = new OllamaEmbeddings({
  model: "nomic-embed-text",
  baseUrl: "http://localhost:11434",
});
module.exports = embeddings;