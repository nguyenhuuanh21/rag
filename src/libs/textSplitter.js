const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 250,
  chunkOverlap: 50,
});
module.exports = textSplitter;