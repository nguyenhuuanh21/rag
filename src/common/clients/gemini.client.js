const { GoogleGenerativeAI } = require("@google/generative-ai");

const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const visionModel = gemini.getGenerativeModel({
  model: "gemini-2.5-flash",
});
module.exports = visionModel