const express = require("express");
const router = express.Router();
const uploadMiddleware = require("../apps/middlewares/upload");
const DocumentController = require("../apps/controllers/apis/document");

router.get("/", (req, res) => {
    res.json({
        status: "success",
        message: "Welcome to the RAG API"
    })
});
router.post("/upload", uploadMiddleware.single("file"),DocumentController.upload);
router.post("/chat", DocumentController.chat)
router.post("/upload-es", uploadMiddleware.single("file"),DocumentController.uploadToElastic);
router.post("/chat-es", DocumentController.chatElastic);
module.exports = router;
