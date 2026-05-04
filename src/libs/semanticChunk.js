const embeddings = require("../common/init.embedding");
const { Document } = require("@langchain/core/documents");
const MAX_CHUNK_CHARS = 800;
const cosineSimilarity = (a, b) => {
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

const extractUniquePages = (sentencesInfo) => {
    const pages = new Set();
    for (const info of sentencesInfo) {
        if (info.metadata?.page) {
            pages.add(info.metadata.page);
        }
    }
    return Array.from(pages);
};

exports.semanticChunker = async (pdfDocs, threshold = 0.75) => {
    let allSentencesInfo = [];

    // BƯỚC 1: Tách câu và nạp metadata SẠCH
    for (const doc of pdfDocs) {
        if (!doc.pageContent || doc.pageContent.trim().length === 0) continue;
        
        const sentences = doc.pageContent.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
        
        for (const sentence of sentences) {
            allSentencesInfo.push({
                text: sentence,
                metadata: doc.metadata // Lúc này metadata chỉ gồm: source, page, total_pages, cloudinary...
            });
        }
    }

    if (allSentencesInfo.length === 0) return [];

    const vectors = await embeddings.embedDocuments(allSentencesInfo.map(s => s.text));
    
    let finalDocuments = [];
    let currentChunkSentencesInfo = [allSentencesInfo[0]]; 
    let currentLength = allSentencesInfo[0].text.length;

    // BƯỚC 2: Semantic Grouping
    for (let i = 1; i < allSentencesInfo.length; i++) {
        const currentSentenceInfo = allSentencesInfo[i];
        const nextLength = currentSentenceInfo.text.length;
        
        const sim = cosineSimilarity(vectors[i - 1], vectors[i]);
        const wouldExceed = currentLength + nextLength + 1 > MAX_CHUNK_CHARS;

        if (sim < threshold || wouldExceed) {
            const uniquePages = extractUniquePages(currentChunkSentencesInfo);
            const pageContent = currentChunkSentencesInfo.map(s => s.text).join(" ");
            
            // Xử lý lại metadata cho chunk cuối
            const chunkMetadata = { ...currentChunkSentencesInfo[0].metadata };
            delete chunkMetadata.page; // Xóa 'page' đơn lẻ để tránh nhầm lẫn
            
            finalDocuments.push(new Document({
                pageContent: pageContent,
                metadata: {
                    ...chunkMetadata,
                    pages: uniquePages, // Thay bằng mảng 'pages' (VD: [1] hoặc [1, 2])
                    chunk_size: pageContent.length
                }
            }));

            currentChunkSentencesInfo = [currentSentenceInfo];
            currentLength = nextLength;
        } else {
            currentChunkSentencesInfo.push(currentSentenceInfo);
            currentLength += nextLength + 1;
        }
    }
    
    // Đóng gói chunk cuối cùng
    if (currentChunkSentencesInfo.length > 0) {
        const uniquePages = extractUniquePages(currentChunkSentencesInfo);
        const pageContent = currentChunkSentencesInfo.map(s => s.text).join(" ");
        
        const chunkMetadata = { ...currentChunkSentencesInfo[0].metadata };
        delete chunkMetadata.page;

        finalDocuments.push(new Document({
            pageContent: pageContent,
            metadata: {
                ...chunkMetadata,
                pages: uniquePages,
                chunk_size: pageContent.length
            }
        }));
    }

    return finalDocuments; 
};