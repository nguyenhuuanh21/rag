const { pipeline, env } = require('@xenova/transformers');

env.cacheDir = 'D:\\o D\\cai dat\\sentence-transfomer';

let rerankerInstance = null;

const getReranker = async () => {
    // Chỉ khởi tạo model nếu nó chưa tồn tại
    if (!rerankerInstance) {
        console.log("Đang kiểm tra và tải model reranker...");
        rerankerInstance = await pipeline('text-ranking', 'Xenova/bge-reranker-base');
        console.log("Khởi tạo model thành công!");
    }
    return rerankerInstance;
};
module.exports = getReranker;