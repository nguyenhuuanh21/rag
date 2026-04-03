const express = require("express");
const router = express.Router();
const uploadMiddleware = require("../apps/middlewares/upload");
const cloudinary = require("cloudinary").v2;
const dotenv = require("dotenv");
dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
router.post("/", uploadMiddleware.single("file"), async (req, res) => {
  try {
    const { body, file } = req;
    if (file) {
      const pdf = await cloudinary.uploader.upload(file.path, {
        folder: "pdfs",
        resource_type: "auto",
        use_filename: true,
        unique_filename: false,
        secure: true,
      });
      return res.status(200).json({
        message: "File uploaded successfully",
        file: pdf,
      });
    }
    return res.status(400).json({
      message: "No file uploaded",
    });
  } catch (err) {
    return res.status(500).json({
      message: "Error uploading file",
      error: err.message,
    });
  }
});

module.exports = router;
