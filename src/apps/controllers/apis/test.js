// const { mongoClient } = require("../../../common/connections/mongo.connection");
// const elasticClient = require("../../../common/connections/elasticsearch.connection");
// const { MongoDBAtlasVectorSearch } = require("@langchain/mongodb");
// const deepseek = require("../../../common/clients/deepseek.client");
// const rerank = require("../../../common/clients/reranker.client");
// const chunks = require("../../../../chunks");
// const ConversationModel = require("../../models/conversation");
// const embeddingModel = require("../../../common/clients/gemini.client");
// const TOP_ELASTIC = 20;      // BM25 lấy top N
// const TOP_VECTOR = Number(process.env.TOP_VECTOR) || 20;       // Vector search lấy top N
// const TOP_RERANK = 15;        // Sau rerank giữ lại top N chunk
// const DELAY_BETWEEN_QUESTIONS = 2000; // 2 giây giữa các câu
// const RERANK_RATE_LIMIT_MS = 12000;   // tối thiểu 12s giữa 2 rerank call (~5 RPM)
// const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
 
// async function rerankWithRetry(question, texts, topK, maxRetries = 5, baseDelay = 3000) {
//     for (let attempt = 1; attempt <= maxRetries; attempt++) {
//         try {
//             return await rerank(question, texts, topK);
//         } catch (err) {
//             const is429 = err.status === 429 || err.message?.includes("429");
//             if (is429 && attempt < maxRetries) {
//                 const wait = err.retryAfter > 0
//                     ? err.retryAfter * 1000
//                     : baseDelay * Math.pow(2, attempt - 1);
//                 console.warn(`[rerank] 429 — retry ${attempt}/${maxRetries} sau ${wait}ms`);
//                 await sleep(wait);
//             } else { throw err; }
//         }
//     }
// }
 
// let _rerankLastCall = 0;
// async function throttledRerank(question, texts, topK) {
//     const now  = Date.now();
//     const wait = RERANK_RATE_LIMIT_MS - (now - _rerankLastCall);
//     if (wait > 0 && _rerankLastCall > 0) {
//         console.log(`[rerank] throttle: waiting ${wait}ms`);
//         await sleep(wait);
//     }
//     _rerankLastCall = Date.now();
//     return rerankWithRetry(question, texts, topK);
// }
 
// // ─────────────────────────────────────────────
// // HELPER metrics
// // ─────────────────────────────────────────────
// function calcHitAtK(retrievedIds, relevantIds, k) {
//     const topK = retrievedIds.slice(0, k);
//     return relevantIds.some((id) => topK.includes(id)) ? 1 : 0;
// }
 
// function calcMRR(retrievedIds, relevantIds) {
//     for (let i = 0; i < retrievedIds.length; i++) {
//         if (relevantIds.includes(retrievedIds[i])) return 1 / (i + 1);
//     }
//     return 0;
// }
 
// function calcNDCG(retrievedIds, relevantIds, k) {
//     const topK = retrievedIds.slice(0, k);
//     let dcg = 0;
//     topK.forEach((id, i) => {
//         if (relevantIds.includes(id)) dcg += 1 / Math.log2(i + 2);
//     });
//     let idcg = 0;
//     const numRelevant = Math.min(relevantIds.length, k);
//     for (let i = 0; i < numRelevant; i++) idcg += 1 / Math.log2(i + 2);
//     return idcg === 0 ? 0 : dcg / idcg;
// }
 
// function aggregateMetrics(evalResults) {
//     const evalable = evalResults.filter((r) => r.relevant_chunk_ids.length > 0);
//     const total    = evalable.length;
//     if (total === 0) return { note: "Không có câu nào có ground truth" };
//     const sum = (key) => evalable.reduce((s, r) => s + r[key], 0);
//     return {
//         total_questions:    evalResults.length,
//         evalable_questions: total,
//         "Hit@3":  parseFloat((sum("hit_at_3")  / total).toFixed(4)),
//         "Hit@5":  parseFloat((sum("hit_at_5")  / total).toFixed(4)),
//         "Hit@10": parseFloat((sum("hit_at_10") / total).toFixed(4)),
//         MRR:      parseFloat((sum("mrr")       / total).toFixed(4)),
//         "nDCG@5": parseFloat((sum("ndcg_at_5") / total).toFixed(4)),
//     };
// }
 
// // ══════════════════════════════════════════════════════════════════
// // API 1 — Vector Search only
// // POST /api/eval/vector
// // ══════════════════════════════════════════════════════════════════
// exports.evalVector = async (req, res) => {
//     try {
//         const { dataset } = req.body;
//         if (!dataset || !Array.isArray(dataset))
//             return res.status(400).json({ status: "error", message: "dataset array is required" });
 
//         const collection  = mongoClient.db("SoTaySinhVien").collection("chunks");
//         const vectorStore = new MongoDBAtlasVectorSearch(embeddingModel, {
//             collection,
//             indexName:    "autoembed_index",
//             textKey:      "text",
//             embeddingKey: "embedding",
//         });
 
//         const results = [];
 
//         for (const item of dataset) {
//             const { id, question, relevant_chunk_ids = [] } = item;
 
//             const vectorResults = await vectorStore.similaritySearch(question, TOP_VECTOR);
//             const retrievedIds  = vectorResults
//                 .map((doc) => doc.metadata?.chunk_id)
//                 .filter(Boolean)
//                 .map(Number);
 
//             results.push({
//                 id,
//                 question,
//                 relevant_chunk_ids,
//                 retrieved_ids: retrievedIds,
//                 hit_at_3:  calcHitAtK(retrievedIds, relevant_chunk_ids, 3),
//                 hit_at_5:  calcHitAtK(retrievedIds, relevant_chunk_ids, 5),
//                 hit_at_10: calcHitAtK(retrievedIds, relevant_chunk_ids, 10),
//                 mrr:       calcMRR(retrievedIds, relevant_chunk_ids),
//                 ndcg_at_5: calcNDCG(retrievedIds, relevant_chunk_ids, 5),
//             });
 
//             await sleep(DELAY_BETWEEN_QUESTIONS);
//         }
 
//         return res.status(200).json({
//             status:  "success",
//             stage:   "A — Vector Search only",
//             metrics: aggregateMetrics(results),
//             details: results,
//         });
//     } catch (err) {
//         console.error("[evalVector] Error:", err.message);
//         return res.status(500).json({ status: "error", message: err.message });
//     }
// };
 
// // ══════════════════════════════════════════════════════════════════
// // API 2 — BM25 (Elasticsearch) only
// // POST /api/eval/bm25
// // ══════════════════════════════════════════════════════════════════
// exports.evalBM25 = async (req, res) => {
//     try {
//         const { dataset } = req.body;
//         if (!dataset || !Array.isArray(dataset))
//             return res.status(400).json({ status: "error", message: "dataset array is required" });
 
//         const results = [];
 
//         for (const item of dataset) {
//             const { id, question, relevant_chunk_ids = [] } = item;
 
//             const elasticResults = await elasticClient.search({
//                 index: "sotaysinhvien",
//                 size:  TOP_ELASTIC,
//                 query: { match: { content: { query: question, operator: "or" } } },
//             });
 
//             const retrievedIds = elasticResults.hits.hits
//                 .map((hit) => hit._source?.metadata?.chunk_id)
//                 .filter((id) => id !== undefined && id !== null)
//                 .map(Number);
 
//             results.push({
//                 id,
//                 question,
//                 relevant_chunk_ids,
//                 retrieved_ids: retrievedIds,
//                 hit_at_3:  calcHitAtK(retrievedIds, relevant_chunk_ids, 3),
//                 hit_at_5:  calcHitAtK(retrievedIds, relevant_chunk_ids, 5),
//                 hit_at_10: calcHitAtK(retrievedIds, relevant_chunk_ids, 10),
//                 mrr:       calcMRR(retrievedIds, relevant_chunk_ids),
//                 ndcg_at_5: calcNDCG(retrievedIds, relevant_chunk_ids, 5),
//             });
//         }
 
//         return res.status(200).json({
//             status:  "success",
//             stage:   "B — BM25 (Elasticsearch) only",
//             metrics: aggregateMetrics(results),
//             details: results,
//         });
//     } catch (err) {
//         console.error("[evalBM25] Error:", err.message);
//         return res.status(500).json({ status: "error", message: err.message });
//     }
// };
 
// // ══════════════════════════════════════════════════════════════════
// // API 3 — Hybrid (Vector + BM25) → Rerank@10
// // POST /api/eval/rerank
// // ══════════════════════════════════════════════════════════════════
// exports.evalRerank = async (req, res) => {
//     try {
//         const { dataset } = req.body;
//         if (!dataset || !Array.isArray(dataset))
//             return res.status(400).json({ status: "error", message: "dataset array is required" });
 
//         const collection  = mongoClient.db("SoTaySinhVien").collection("chunks");
//         const vectorStore = new MongoDBAtlasVectorSearch(embeddingModel, {
//             collection,
//             indexName:    "autoembed_index",
//             textKey:      "text",
//             embeddingKey: "embedding",
//         });
 
//         const results = [];
 
//         for (const item of dataset) {
//             const { id, question, relevant_chunk_ids = [] } = item;
 
//             // Bước 1: Parallel search
//             const [elasticResults, vectorResults] = await Promise.all([
//                 elasticClient.search({
//                     index: "sotaysinhvien",
//                     size:  TOP_ELASTIC,
//                     query: { match: { content: { query: question, operator: "or" } } },
//                 }),
//                 vectorStore.similaritySearch(question, TOP_VECTOR),
//             ]);
 
//             // Bước 2: Dedup
//             const uniqueChunksMap = new Map();
 
//             elasticResults.hits.hits.forEach((hit) => {
//                 const content = hit._source.content;
//                 const chunkId = hit._source?.metadata?.chunk_id ?? null;
//                 const pages   = hit._source.metadata?.page || [];
//                 if (!uniqueChunksMap.has(content))
//                     uniqueChunksMap.set(content, { content, chunk_id: chunkId, pages });
//             });
 
//             vectorResults.forEach((doc) => {
//                 const content = doc.pageContent;
//                 const chunkId = doc.metadata?.chunk_id;
//                 const pages   = doc.metadata?.page || [];
//                 if (!uniqueChunksMap.has(content))
//                     uniqueChunksMap.set(content, { content, chunk_id: chunkId, pages });
//             });
 
//             const uniqueDocuments = Array.from(uniqueChunksMap.values());
//             const uniqueTexts     = uniqueDocuments.map((d) => d.content);
 
//             if (uniqueDocuments.length === 0) {
//                 results.push({
//                     id, question, relevant_chunk_ids,
//                     retrieved_ids: [],
//                     hit_at_3: 0, hit_at_5: 0, hit_at_10: 0, mrr: 0, ndcg_at_5: 0,
//                 });
//                 continue;
//             }
 
//             // Bước 3: Rerank@10
//             const rerankData   = await throttledRerank(question, uniqueTexts, TOP_RERANK);
//             const topChunks    = rerankData.results.map((r) => ({
//                 chunk_id: uniqueDocuments[r.index].chunk_id,
//                 score:    r.relevance_score,
//             }));
//             const retrievedIds = topChunks
//                 .map((c) => c.chunk_id)
//                 .filter(Boolean)
//                 .map(Number);
 
//             await sleep(DELAY_BETWEEN_QUESTIONS);
 
//             results.push({
//                 id,
//                 question,
//                 relevant_chunk_ids,
//                 retrieved_ids: retrievedIds,
//                 rerank_scores: topChunks.map((c) => ({
//                     chunk_id: c.chunk_id,
//                     score:    parseFloat(c.score.toFixed(4)),
//                 })),
//                 hit_at_3:  calcHitAtK(retrievedIds, relevant_chunk_ids, 3),
//                 hit_at_5:  calcHitAtK(retrievedIds, relevant_chunk_ids, 5),
//                 hit_at_10: calcHitAtK(retrievedIds, relevant_chunk_ids, 10),
//                 mrr:       calcMRR(retrievedIds, relevant_chunk_ids),
//                 ndcg_at_5: calcNDCG(retrievedIds, relevant_chunk_ids, 5),
//             });
//         }
 
//         return res.status(200).json({
//             status:  "success",
//             stage:   "C — Hybrid (Vector + BM25) → Rerank@10",
//             metrics: aggregateMetrics(results),
//             details: results,
//         });
//     } catch (err) {
//         console.error("[evalRerank] Error:", err.message);
//         return res.status(500).json({ status: "error", message: err.message });
//     }
// };
 
// // ══════════════════════════════════════════════════════════════════
// // API 4 — Chạy cả 3 cấu hình cùng lúc → bảng so sánh
// // POST /api/eval/full
// // ══════════════════════════════════════════════════════════════════
// exports.evalFull = async (req, res) => {
//     try {
//         const { dataset } = req.body;
//         if (!dataset || !Array.isArray(dataset))
//             return res.status(400).json({ status: "error", message: "dataset array is required" });
 
//         const collection  = mongoClient.db("SoTaySinhVien").collection("chunks");
//         const vectorStore = new MongoDBAtlasVectorSearch(embeddingModel, {
//             collection,
//             indexName:    "autoembed_index",
//             textKey:      "text",
//             embeddingKey: "embedding",
//         });
 
//         const vectorResults_all = [];
//         const bm25Results_all   = [];
//         const rerankResults_all = [];
 
//         for (const item of dataset) {
//             const { id, question, relevant_chunk_ids = [] } = item;
 
//             const [elasticRes, vectorRes] = await Promise.all([
//                 elasticClient.search({
//                     index: "sotaysinhvien",
//                     size:  TOP_ELASTIC,
//                     query: { match: { content: { query: question, operator: "or" } } },
//                 }),
//                 vectorStore.similaritySearch(question, TOP_VECTOR),
//             ]);
 
//             const vIds = vectorRes
//                 .map((d) => d.metadata?.chunk_id)
//                 .filter(Boolean)
//                 .map(Number);
 
//             const bIds = elasticRes.hits.hits
//                 .map((h) => h._source?.metadata?.chunk_id)
//                 .filter((id) => id !== undefined && id !== null)
//                 .map(Number);
 
//             const uniqueMap = new Map();
//             elasticRes.hits.hits.forEach((hit) => {
//                 const c = hit._source.content;
//                 if (!uniqueMap.has(c))
//                     uniqueMap.set(c, {
//                         content:  c,
//                         chunk_id: hit._source?.metadata?.chunk_id ?? null,
//                         pages:    hit._source.metadata?.page || [],
//                     });
//             });
//             vectorRes.forEach((doc) => {
//                 const c = doc.pageContent;
//                 if (!uniqueMap.has(c))
//                     uniqueMap.set(c, {
//                         content:  c,
//                         chunk_id: doc.metadata?.chunk_id,
//                         pages:    doc.metadata?.page || [],
//                     });
//             });
 
//             const uniqueDocs  = Array.from(uniqueMap.values());
//             const uniqueTexts = uniqueDocs.map((d) => d.content);
 
//             const rerankData = await throttledRerank(question, uniqueTexts, TOP_RERANK);
//             const rIds = rerankData.results
//                 .map((r) => uniqueDocs[r.index]?.chunk_id)
//                 .filter(Boolean)
//                 .map(Number);
 
//             const makeRow = (retrievedIds) => ({
//                 id,
//                 question,
//                 relevant_chunk_ids,
//                 retrieved_ids: retrievedIds,
//                 hit_at_3:  calcHitAtK(retrievedIds, relevant_chunk_ids, 3),
//                 hit_at_5:  calcHitAtK(retrievedIds, relevant_chunk_ids, 5),
//                 hit_at_10: calcHitAtK(retrievedIds, relevant_chunk_ids, 10),
//                 mrr:       calcMRR(retrievedIds, relevant_chunk_ids),
//                 ndcg_at_5: calcNDCG(retrievedIds, relevant_chunk_ids, 5),
//             });
 
//             vectorResults_all.push(makeRow(vIds));
//             bm25Results_all.push(makeRow(bIds));
//             rerankResults_all.push(makeRow(rIds));
 
//             await sleep(DELAY_BETWEEN_QUESTIONS);
//         }
 
//         return res.status(200).json({
//             status: "success",
//             comparison_table: {
//                 "A_Vector_only":        aggregateMetrics(vectorResults_all),
//                 "B_BM25_only":          aggregateMetrics(bm25Results_all),
//                 "C_Hybrid_plus_Rerank": aggregateMetrics(rerankResults_all),
//             },
//             details: {
//                 vector: vectorResults_all,
//                 bm25:   bm25Results_all,
//                 rerank: rerankResults_all,
//             },
//         });
//     } catch (err) {
//         console.error("[evalFull] Error:", err.message);
//         return res.status(500).json({ status: "error", message: err.message });
//     }
// };
 
// // ══════════════════════════════════════════════════════════════════
// // API 5 — Multi-chunk Evaluation (Recall@K + nDCG@K)
// // POST /api/eval/rerank-multi
// // Dùng riêng cho bộ test 20 câu multi-chunk
// // ══════════════════════════════════════════════════════════════════
 
// // Recall@K: bao nhiêu % số chunk đúng được tìm thấy trong top K
// function calcRecallAtK(retrievedIds, relevantIds, k) {
//     if (relevantIds.length === 0) return null;
//     const topK = retrievedIds.slice(0, k);
//     const found = relevantIds.filter((id) => topK.includes(id)).length;
//     return parseFloat((found / relevantIds.length).toFixed(4));
// }
 
// // Precision@K: trong top K, bao nhiêu % là chunk đúng
// function calcPrecisionAtK(retrievedIds, relevantIds, k) {
//     if (k === 0) return 0;
//     const topK = retrievedIds.slice(0, k);
//     const found = topK.filter((id) => relevantIds.includes(id)).length;
//     return parseFloat((found / k).toFixed(4));
// }
 
// // nDCG@K với multiple relevant (binary relevance)
// function calcNDCGMulti(retrievedIds, relevantIds, k) {
//     const topK = retrievedIds.slice(0, k);
//     let dcg = 0;
//     topK.forEach((id, i) => {
//         if (relevantIds.includes(id)) dcg += 1 / Math.log2(i + 2);
//     });
//     // IDCG: tất cả relevant nằm ở top (tối đa min(|relevant|, k))
//     let idcg = 0;
//     const numRelevant = Math.min(relevantIds.length, k);
//     for (let i = 0; i < numRelevant; i++) idcg += 1 / Math.log2(i + 2);
//     return idcg === 0 ? 0 : parseFloat((dcg / idcg).toFixed(4));
// }
 
// function aggregateMultiMetrics(evalResults) {
//     const evalable = evalResults.filter((r) => r.relevant_chunk_ids.length > 0);
//     const total    = evalable.length;
//     if (total === 0) return { note: "Không có câu nào có ground truth" };
 
//     const avg = (key) => parseFloat(
//         (evalable.reduce((s, r) => s + (r[key] ?? 0), 0) / total).toFixed(4)
//     );
 
//     const hasField = (key) => evalable.some(r => r[key] !== undefined);
//     const result = {
//         total_questions:    evalResults.length,
//         evalable_questions: total,
//         avg_relevant_chunks: parseFloat(
//             (evalable.reduce((s, r) => s + r.relevant_chunk_ids.length, 0) / total).toFixed(2)
//         ),
//         // Hit
//         "Hit@3":       avg("hit_at_3"),
//         "Hit@5":       avg("hit_at_5"),
//         "Hit@10":      avg("hit_at_10"),
//         // Recall
//         "Recall@5":    avg("recall_at_5"),
//         "Recall@10":   avg("recall_at_10"),
//         // nDCG
//         "nDCG@5":      avg("ndcg_at_5"),
//         "nDCG@10":     avg("ndcg_at_10"),
//         // MRR
//         MRR:           avg("mrr"),
//     };
//     // Thêm metric theo ngưỡng thực tế từng cấu hình
//     if (hasField("hit_at_15"))   result["Hit@15"]    = avg("hit_at_15");
//     if (hasField("hit_at_20"))   result["Hit@20"]    = avg("hit_at_20");
//     if (hasField("recall_at_15")) result["Recall@15"] = avg("recall_at_15");
//     if (hasField("recall_at_20")) result["Recall@20"] = avg("recall_at_20");
//     if (hasField("ndcg_at_15"))  result["nDCG@15"]   = avg("ndcg_at_15");
//     if (hasField("ndcg_at_20"))  result["nDCG@20"]   = avg("ndcg_at_20");
//     return result;
// }
 
// exports.evalRerankMulti = async (req, res) => {
//     try {
//         const { dataset } = req.body;
//         if (!dataset || !Array.isArray(dataset))
//             return res.status(400).json({ status: "error", message: "dataset array is required" });
 
//         const collection  = mongoClient.db("SoTaySinhVien").collection("chunks");
//         const vectorStore = new MongoDBAtlasVectorSearch(embeddingModel, {
//             collection,
//             indexName:    "autoembed_index",
//             textKey:      "text",
//             embeddingKey: "embedding",
//         });
 
//         const results = [];
 
//         for (const item of dataset) {
//             const { id, question, relevant_chunk_ids = [] } = item;
 
//             // Parallel search
//             const [elasticResults, vectorResults] = await Promise.all([
//                 elasticClient.search({
//                     index: "sotaysinhvien",
//                     size:  TOP_ELASTIC,
//                     query: { match: { content: { query: question, operator: "or" } } },
//                 }),
//                 vectorStore.similaritySearch(question, TOP_VECTOR),
//             ]);
 
//             // Dedup
//             const uniqueChunksMap = new Map();
//             elasticResults.hits.hits.forEach((hit) => {
//                 const content = hit._source.content;
//                 const chunkId = hit._source?.metadata?.chunk_id ?? null;
//                 const pages   = hit._source.metadata?.page || [];
//                 if (!uniqueChunksMap.has(content))
//                     uniqueChunksMap.set(content, { content, chunk_id: chunkId, pages });
//             });
//             vectorResults.forEach((doc) => {
//                 const content = doc.pageContent;
//                 const chunkId = doc.metadata?.chunk_id;
//                 const pages   = doc.metadata?.page || [];
//                 if (!uniqueChunksMap.has(content))
//                     uniqueChunksMap.set(content, { content, chunk_id: chunkId, pages });
//             });
 
//             const uniqueDocuments = Array.from(uniqueChunksMap.values());
//             const uniqueTexts     = uniqueDocuments.map((d) => d.content);
 
//             if (uniqueDocuments.length === 0) {
//                 results.push({
//                     id, question, relevant_chunk_ids,
//                     retrieved_ids: [],
//                     hit_at_3: 0, hit_at_5: 0, hit_at_10: 0, hit_at_15: 0,
//                     recall_at_5: 0, recall_at_10: 0, recall_at_15: 0,
//                     ndcg_at_5: 0, ndcg_at_10: 0, ndcg_at_15: 0,
//                     mrr: 0,
//                 });
//                 continue;
//             }
 
//             // Rerank@10
//             const rerankData   = await throttledRerank(question, uniqueTexts, TOP_RERANK);
//             const topChunks    = rerankData.results.map((r) => ({
//                 chunk_id: uniqueDocuments[r.index].chunk_id,
//                 score:    r.relevance_score,
//             }));
//             const retrievedIds = topChunks
//                 .map((c) => c.chunk_id)
//                 .filter(Boolean)
//                 .map(Number);
 
//             await sleep(DELAY_BETWEEN_QUESTIONS);
 
//             results.push({
//                 id,
//                 question,
//                 relevant_chunk_ids,
//                 num_relevant:  relevant_chunk_ids.length,
//                 retrieved_ids: retrievedIds,
//                 rerank_scores: topChunks.map((c) => ({
//                     chunk_id: c.chunk_id,
//                     score:    parseFloat(c.score.toFixed(4)),
//                 })),
//                 // Hit metrics
//                 hit_at_3:       calcHitAtK(retrievedIds, relevant_chunk_ids, 3),
//                 hit_at_5:       calcHitAtK(retrievedIds, relevant_chunk_ids, 5),
//                 hit_at_10:      calcHitAtK(retrievedIds, relevant_chunk_ids, 10),
//                 hit_at_15:      calcHitAtK(retrievedIds, relevant_chunk_ids, 15),
//                 // Recall metrics — quan trọng nhất cho multi-chunk
//                 recall_at_5:    calcRecallAtK(retrievedIds, relevant_chunk_ids, 5),
//                 recall_at_10:   calcRecallAtK(retrievedIds, relevant_chunk_ids, 10),
//                 recall_at_15:   calcRecallAtK(retrievedIds, relevant_chunk_ids, 15),
//                 // nDCG với multiple relevant
//                 ndcg_at_5:      calcNDCGMulti(retrievedIds, relevant_chunk_ids, 5),
//                 ndcg_at_10:     calcNDCGMulti(retrievedIds, relevant_chunk_ids, 10),
//                 ndcg_at_15:     calcNDCGMulti(retrievedIds, relevant_chunk_ids, 15),
//                 // MRR
//                 mrr:            calcMRR(retrievedIds, relevant_chunk_ids),
//             });
//         }
 
//         return res.status(200).json({
//             status:  "success",
//             stage:   "Multi-chunk — Hybrid + Rerank@10",
//             metrics: aggregateMultiMetrics(results),
//             details: results,
//         });
//     } catch (err) {
//         console.error("[evalRerankMulti] Error:", err.message);
//         return res.status(500).json({ status: "error", message: err.message });
//     }
// };
 
// // ══════════════════════════════════════════════════════════════════
// // API 6 — Vector Search only (Multi-chunk)
// // POST /api/eval/vector-multi
// // ══════════════════════════════════════════════════════════════════
// exports.evalVectorMulti = async (req, res) => {
//     try {
//         const { dataset } = req.body;
//         if (!dataset || !Array.isArray(dataset))
//             return res.status(400).json({ status: "error", message: "dataset array is required" });
 
//         const collection  = mongoClient.db("SoTaySinhVien").collection("chunks");
//         const vectorStore = new MongoDBAtlasVectorSearch(embeddingModel, {
//             collection,
//             indexName:    "autoembed_index",
//             textKey:      "text",
//             embeddingKey: "embedding",
//         });
 
//         const results = [];
 
//         for (const item of dataset) {
//             const { id, question, relevant_chunk_ids = [] } = item;
 
//             const vectorResults = await vectorStore.similaritySearch(question, TOP_VECTOR);
//             const retrievedIds  = vectorResults
//                 .map((doc) => doc.metadata?.chunk_id)
//                 .filter(Boolean)
//                 .map(Number);
 
//             await sleep(DELAY_BETWEEN_QUESTIONS);
 
//             results.push({
//                 id,
//                 question,
//                 relevant_chunk_ids,
//                 num_relevant:   relevant_chunk_ids.length,
//                 retrieved_ids:  retrievedIds,
//                 hit_at_3:       calcHitAtK(retrievedIds, relevant_chunk_ids, 3),
//                 hit_at_5:       calcHitAtK(retrievedIds, relevant_chunk_ids, 5),
//                 hit_at_10:      calcHitAtK(retrievedIds, relevant_chunk_ids, 10),
//                 hit_at_20:      calcHitAtK(retrievedIds, relevant_chunk_ids, 20),
//                 recall_at_5:    calcRecallAtK(retrievedIds, relevant_chunk_ids, 5),
//                 recall_at_10:   calcRecallAtK(retrievedIds, relevant_chunk_ids, 10),
//                 recall_at_20:   calcRecallAtK(retrievedIds, relevant_chunk_ids, 20),
//                 ndcg_at_5:      calcNDCGMulti(retrievedIds, relevant_chunk_ids, 5),
//                 ndcg_at_10:     calcNDCGMulti(retrievedIds, relevant_chunk_ids, 10),
//                 ndcg_at_20:     calcNDCGMulti(retrievedIds, relevant_chunk_ids, 20),
//                 mrr:            calcMRR(retrievedIds, relevant_chunk_ids),
//             });
//         }
 
//         return res.status(200).json({
//             status:  "success",
//             stage:   "A — Vector Search only (Multi-chunk)",
//             metrics: aggregateMultiMetrics(results),
//             details: results,
//         });
//     } catch (err) {
//         console.error("[evalVectorMulti] Error:", err.message);
//         return res.status(500).json({ status: "error", message: err.message });
//     }
// };
 
// // ══════════════════════════════════════════════════════════════════
// // API 7 — BM25 only (Multi-chunk)
// // POST /api/eval/bm25-multi
// // ══════════════════════════════════════════════════════════════════
// exports.evalBM25Multi = async (req, res) => {
//     try {
//         const { dataset } = req.body;
//         if (!dataset || !Array.isArray(dataset))
//             return res.status(400).json({ status: "error", message: "dataset array is required" });
 
//         const results = [];
 
//         for (const item of dataset) {
//             const { id, question, relevant_chunk_ids = [] } = item;
 
//             const elasticResults = await elasticClient.search({
//                 index: "sotaysinhvien",
//                 size:  TOP_ELASTIC,
//                 query: { match: { content: { query: question, operator: "or" } } },
//             });
 
//             const retrievedIds = elasticResults.hits.hits
//                 .map((hit) => hit._source?.metadata?.chunk_id)
//                 .filter((id) => id !== undefined && id !== null)
//                 .map(Number);
 
//             results.push({
//                 id,
//                 question,
//                 relevant_chunk_ids,
//                 num_relevant:   relevant_chunk_ids.length,
//                 retrieved_ids:  retrievedIds,
//                 hit_at_3:       calcHitAtK(retrievedIds, relevant_chunk_ids, 3),
//                 hit_at_5:       calcHitAtK(retrievedIds, relevant_chunk_ids, 5),
//                 hit_at_10:      calcHitAtK(retrievedIds, relevant_chunk_ids, 10),
//                 hit_at_20:      calcHitAtK(retrievedIds, relevant_chunk_ids, 20),
//                 recall_at_5:    calcRecallAtK(retrievedIds, relevant_chunk_ids, 5),
//                 recall_at_10:   calcRecallAtK(retrievedIds, relevant_chunk_ids, 10),
//                 recall_at_20:   calcRecallAtK(retrievedIds, relevant_chunk_ids, 20),
//                 ndcg_at_5:      calcNDCGMulti(retrievedIds, relevant_chunk_ids, 5),
//                 ndcg_at_10:     calcNDCGMulti(retrievedIds, relevant_chunk_ids, 10),
//                 ndcg_at_20:     calcNDCGMulti(retrievedIds, relevant_chunk_ids, 20),
//                 mrr:            calcMRR(retrievedIds, relevant_chunk_ids),
//             });
//         }
 
//         return res.status(200).json({
//             status:  "success",
//             stage:   "B — BM25 only (Multi-chunk)",
//             metrics: aggregateMultiMetrics(results),
//             details: results,
//         });
//     } catch (err) {
//         console.error("[evalBM25Multi] Error:", err.message);
//         return res.status(500).json({ status: "error", message: err.message });
//     }
// };
 