const LlamaCloud = require('@llamaindex/llama-cloud').LlamaCloud;
const llamaClient = new LlamaCloud({
    apiKey: process.env.LLAMA_CLOUD_API_KEY,
    resultType: "markdown",
});
module.exports = llamaClient;