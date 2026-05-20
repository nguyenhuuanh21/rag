const express = require("express");
const router = express.Router();
const DocumentController = require("../apps/controllers/apis/document");
const UserController = require("../apps/controllers/apis/user");
const {registerRules} = require("../apps/middlewares/userValidator");
const { verifyAccessToken, verifyRefreshToken } = require('../apps/middlewares/userAuth')
router.get("/", (req, res) => {
    res.json({
        status: "success",
        message: "Welcome to the RAG API"
    })
});
//document routes
router.post("/chat",verifyAccessToken,DocumentController.chatHybrid);
router.post("/insert",DocumentController.insertData);
router.get("/get-chat-history",verifyAccessToken,DocumentController.getChatHistory);
router.delete("/clear-chat-history",verifyAccessToken,DocumentController.clearChatHistory);
//user routes
router.post("/register",registerRules,UserController.register);
router.post("/login",UserController.login);
router.post("/refresh-token",verifyRefreshToken,UserController.refreshToken);
router.post("/logout",verifyAccessToken,UserController.logout);

module.exports = router;










 