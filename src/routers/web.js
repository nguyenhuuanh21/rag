const express = require("express");
const router = express.Router();
const DocumentController = require("../apps/controllers/apis/document");
const UserController = require("../apps/controllers/apis/user");
const TestController = require("../apps/controllers/apis/test");
const { registerRules, loginRules } = require("../apps/middlewares/userValidator");
const { verifyAccessToken, verifyRefreshToken } = require('../apps/middlewares/userAuth');
const rateLimiter = require('../apps/middlewares/rateLimiter');

router.get("/", (req, res) => {
    res.json({ status: "success", message: "Welcome to the RAG API" });
});

router.post("/chat/:chatId",verifyAccessToken, rateLimiter, DocumentController.chatHybrid);
router.get("/get-chat/:chatId",verifyAccessToken, DocumentController.getChatHistory);
router.get("/get-all-chat",verifyAccessToken, DocumentController.getAllConversations);
router.post("/create-chat", verifyAccessToken, DocumentController.createConversation);
router.delete("/delete-chat/:chatId", verifyAccessToken, DocumentController.clearChatHistory);
router.post("/search-chat", verifyAccessToken, DocumentController.searchConversations);


//User auth
router.post("/register",registerRules, UserController.register);
router.post("/login",loginRules,    UserController.login);
router.post("/refresh-token", verifyRefreshToken, UserController.refreshToken);
router.post("/logout",verifyAccessToken,  UserController.logout);
router.post("/forgot-password", UserController.forgotPassword);
router.post("/verify-otp", UserController.verifyOtp);
router.post("/reset-password", UserController.resetPassword);

router.post("/insert", verifyAccessToken, DocumentController.insertData);

router.post("/vector",       TestController.evalVector);
router.post("/bm25",         TestController.evalBM25);
router.post("/rerank",       TestController.evalRerank);
router.post("/vector-multi", TestController.evalVectorMulti);
router.post("/bm25-multi",   TestController.evalBM25Multi);
router.post("/rerank-multi", TestController.evalRerankMulti);
router.post("/full",         TestController.evalFull);

module.exports = router;










 