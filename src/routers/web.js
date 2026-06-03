const express = require("express");
const router = express.Router();
const DocumentController = require("../apps/controllers/apis/document");
const ChatController = require("../apps/controllers/apis/chat");    
const UserController = require("../apps/controllers/apis/user");

const AdminController = require("../apps/controllers/apis/admin");
const { registerRules, loginRules } = require("../apps/middlewares/userValidator");
const { registerAdminRules, loginAdminRules } = require("../apps/middlewares/adminvalidate");
const { verifyAccessToken, verifyRefreshToken } = require('../apps/middlewares/userAuth');
const {verifyAccessTokenAdmin,verifyRefreshTokenAdmin } = require('../apps/middlewares/adminAuth');
const rateLimiter = require('../apps/middlewares/rateLimiter');
const upload=require("../apps/middlewares/upload");

router.get("/", (req, res) => {
    res.json({ status: "success", message: "Welcome to the RAG API" });
});

//co indexing
router.get("/documents", verifyAccessToken, DocumentController.getDocuments);
router.post("/chat/:documentId/:chatId",verifyAccessToken, rateLimiter, ChatController.chatHybrid);
router.get("/get-chat/:documentId/:chatId",verifyAccessToken, ChatController.getChatHistory);
router.get("/get-all-chat/:documentId",verifyAccessToken, ChatController.getAllConversations);
router.post("/create-chat/:documentId", verifyAccessToken, ChatController.createConversation);
router.delete("/delete-chat/:documentId/:chatId", verifyAccessToken, ChatController.clearChatHistory);
router.post("/search-chat/:documentId", verifyAccessToken, ChatController.searchConversations);

//User auth
router.post("/register",registerRules, UserController.register);
router.post("/login",loginRules,    UserController.login);
router.post("/refresh-token", verifyRefreshToken, UserController.refreshToken);
router.post("/logout",verifyAccessToken,  UserController.logout);
router.post("/forgot-password", UserController.forgotPassword);
router.post("/verify-otp", UserController.verifyOtp);
router.post("/reset-password", UserController.resetPassword);
//Admin auth

router.post("/admin/register", registerAdminRules, AdminController.register);
router.post("/admin/login", loginAdminRules, AdminController.login);
router.post("/admin/logout", verifyAccessTokenAdmin, AdminController.logout);
router.post("/admin/refresh", verifyRefreshTokenAdmin, AdminController.refreshToken);

//admin document management
router.post("/admin/index", verifyAccessTokenAdmin,upload.single('file'), DocumentController.indexing);
router.get("/admin/documents", verifyAccessTokenAdmin, DocumentController.getDocuments);
router.delete("/admin/delete", verifyAccessTokenAdmin, DocumentController.deleteDocument);
router.put("/admin/update", verifyAccessTokenAdmin, DocumentController.updateDocument);
router.get("/admin/chunks/:documentId", verifyAccessTokenAdmin, DocumentController.getChunksByDocument);
router.put("/admin/chunks/:documentId/:chunkId", verifyAccessTokenAdmin, DocumentController.updateChunk);
router.delete("/admin/chunks/:documentId/:chunkId", verifyAccessTokenAdmin, DocumentController.deleteChunk);



module.exports = router;










 