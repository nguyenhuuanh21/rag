const embeddings = require("../common/init.embedding");
const { Document } = require("@langchain/core/documents");
const MAX_CHUNK_CHARS = 1500;
const truncateForEmbedding = (text, maxChars = MAX_CHUNK_CHARS) => {
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars).replace(/\s+\S*$/, "");
}
const cosineSimilarity = (a, b) => {
    const dotProduct = a.reduce((sum, val, i) => {
        return sum + (val * b[i])
    }, 0)
    const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (normA * normB);
}
const buildPageRanges = (chunkDocs) => {
    const pageRanges = []
    for (const doc of chunkDocs) {
        const page = doc.metadata.loc.pageNumber
        const from = doc.metadata.loc.lines.from
        const to = doc.metadata.loc.lines.to
        const last = pageRanges[pageRanges.length - 1]
        if (last && last.page === page) {
            last.to = to
        } else {
            pageRanges.push({
                page,
                from,
                to
            })
        }
    }
    return pageRanges;
}
exports.semanticChunker = async (docs, threshold = 0.7) => {
    // Tách thành từng câu
    const validDocs = docs.filter(doc => doc.pageContent.trim().length > 0);
    if (validDocs.length === 0) return [];
    // Truncate mỗi câu trước khi embed để tránh lỗi context length
    const sentences = validDocs.map(doc => truncateForEmbedding(doc.pageContent.trim()));
    // Embed tất cả câu
    const vectors = await embeddings.embedDocuments(sentences);
    // Tính similarity giữa các câu liền kề
    let chunks = []
    let currentDocs = [validDocs[0]];
    let currentVector = vectors[0];
    let currentLength = validDocs[0].pageContent.length;
    for (let i = 1; i < validDocs.length; i++) {
        const sim = cosineSimilarity(currentVector, vectors[i]);
        const nextLength=validDocs[i].pageContent.length;
        // Tách chunk nếu:
        //   1. Similarity thấp hơn ngưỡng, HOẶC
        //   2. Gộp thêm sẽ vượt giới hạn MAX_CHUNK_CHARS
        const wouldExceed=currentLength+nextLength+1>MAX_CHUNK_CHARS; // +1 cho khoảng trắng
        if (sim < threshold || wouldExceed) {
            chunks.push(currentDocs);
            currentDocs = [validDocs[i]];
            currentVector = vectors[i];
            currentLength = nextLength;
        } else {
            const n = currentDocs.length;
            currentDocs.push(validDocs[i]);
            currentVector = currentVector.map((v, idx) =>
                (v * n + vectors[i][idx]) / (n + 1)
            );
            currentLength += nextLength + 1; // +1 cho dấu cách khi join
        }
    }
    chunks.push(currentDocs);
    return chunks.map(chunkDocs => {
        const pageRanges = buildPageRanges(chunkDocs);
        return new Document({
            pageContent: chunkDocs.map(d => d.pageContent).join(" "),
            metadata: {
                ...chunkDocs[0].metadata,   // giữ metadata gốc
                page_ranges: pageRanges,    // [{page, from, to}, ...]
                chunk_size: chunkDocs.length,
            }
        })
    });
}