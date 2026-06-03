const {mongoose} = require("../../common/connections/mongo.connection");
const documentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    cloudinary_link: {
      type: String,
      required: true,
    }
  },
  { timestamps: true }
);
const DocumentModel = mongoose.model("Documents", documentSchema, "documents");
module.exports = DocumentModel;