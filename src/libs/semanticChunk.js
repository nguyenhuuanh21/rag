const embeddings = require("../common/init.embedding");
const cosineSimilarity = (a, b) => {
    const dotProduct = a.reduce((sum, val, i) => {
        return sum + (val * b[i])
    }, 0)
    const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (normA * normB);
}
exports.semanticChunker = async (text, threshold = 0.8) => {
    // Tách thành từng câu
    const sentences = text.split(/(?<=[.!?)])\s+/).filter(s => s.trim());
    // Embed tất cả câu
    const vectors = await embeddings.embedDocuments(sentences);
    // Tính similarity giữa các câu liền kề
    let chunks = []
    let currentChunk = [sentences[0]];
    let currentVector = vectors[0];
    for (let i = 1; i < sentences.length; i++) {
        const sim = cosineSimilarity(currentVector, vectors[i]);
        if (sim < threshold) {
            chunks.push(currentChunk);
            currentChunk = [sentences[i]];
            currentVector = vectors[i];
        } else {
            currentChunk.push(sentences[i]);
            currentVector = currentVector.map((v, idx) =>
                (v * (currentChunk.length - 1) + vectors[i][idx]) / currentChunk.length
            );
        }
    }
    chunks.push(currentChunk);
    return chunks;
}