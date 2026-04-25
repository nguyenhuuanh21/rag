const embeddings = require("../common/init.embedding");
const { Document } = require("@langchain/core/documents");
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
    const sentences = validDocs.map(doc => doc.pageContent.trim());
    // Embed tất cả câu
    const vectors = await embeddings.embedDocuments(sentences);
    // Tính similarity giữa các câu liền kề
    let chunks = []
    let currentDocs = [validDocs[0]];
    let currentVector = vectors[0];
    for (let i = 1; i < validDocs.length; i++) {
        const sim = cosineSimilarity(currentVector, vectors[i]);
        if (sim < threshold) {
            chunks.push(currentDocs);
            currentDocs = [validDocs[i]];
            currentVector = vectors[i];
        } else {
            const n = currentDocs.length;
            currentDocs.push(validDocs[i]);
            currentVector = currentVector.map((v, idx) =>
                (v * n + vectors[i][idx]) / (n + 1)
            );
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