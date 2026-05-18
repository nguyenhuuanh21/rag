const { mongoose } = require("../../common/connections/mongo.connection");
const conversationSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Users",
            required: true,
        },
        role: {
            type: String,
            enum: ["user", "assistant"],
            required: true,
        },
        content: {
            type: String,
            required: true,
        }
    },
    { timestamps: true } 
);
const ConversationModel = mongoose.model("Conversations", conversationSchema, "conversations");
module.exports = ConversationModel;