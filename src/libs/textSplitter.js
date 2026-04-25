const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");

const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 300,        // hoặc 500–1000 tùy model
  chunkOverlap: 50,      // giữ ngữ cảnh giữa các chunk
  separators: [
    "\n\n",              // ưu tiên đoạn
    "\n",
    "(?<=[.!?])\\s+",    // rồi mới đến câu
  ],
  isSeparatorRegex: true,
});

module.exports = textSplitter;