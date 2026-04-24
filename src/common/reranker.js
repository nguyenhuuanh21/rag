// reranker.mjs
const {
  AutoTokenizer,
  AutoModelForSequenceClassification,
  env,
} = require("@huggingface/transformers");

// set cache local
env.cacheDir = "D:\\model";

let tokenizer = null;
let model = null;

async function getReranker() {
  if (!tokenizer || !model) {
    console.log("⏳ Loading reranker (manual)...");

    const modelName = "Xenova/bge-reranker-base";

    tokenizer = await AutoTokenizer.from_pretrained(modelName);
    model = await AutoModelForSequenceClassification.from_pretrained(
      modelName,
      { device: "cpu" }
    );

    console.log("✅ Reranker loaded!");
  }

  return { tokenizer, model };
}

module.exports = getReranker;