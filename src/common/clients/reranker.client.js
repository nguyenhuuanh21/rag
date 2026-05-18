
async function rerank(query, documents, top_n = 2) {
    const response = await fetch("https://api.jina.ai/v1/rerank", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.JINA_API_KEY}`
        },
        body: JSON.stringify({
            model: "jina-reranker-v2-base-multilingual",
            query,
            documents,
            top_n
        })
    });

    if (!response.ok) {
        throw new Error(`Rerank failed: ${response.status}`);
    }

    return await response.json();
}
module.exports = rerank;