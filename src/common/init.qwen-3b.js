const { ChatOllama } = require("@langchain/ollama");
const llm = new ChatOllama({
  model: "qwen2.5:3b", 
  baseUrl: "http://localhost:11434",
  temperature: 0.2, 
});
module.exports = llm;