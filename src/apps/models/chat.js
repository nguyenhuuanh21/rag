const { mongoose } = require("../../common/connections/mongo.connection");

const messageSchema = new mongoose.Schema(
    {
        role: {
            type: String,
            enum: ["user", "assistant"],
            required: true,
        },
        content: {
            type: String,
            required: true,
        },
        createdAt: {
            type: Date,
            default: Date.now,
        },
    },
);

const chatSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId, 
            ref: "Users",
            required: true,
        },
        documentId: {
            type: mongoose.Schema.Types.ObjectId, 
            ref: "Documents",
            required: true,
        },
        name: {
            type: String,
            default: "Cuộc trò chuyện mới",
            required: true,
        },
        messages: {
            type: [messageSchema],
            default: [],
        },
        lastUsedChunks: [
            {
                content: String,
                pages: [Number]
            }
        ],
        lastActiveAt: {
            type: Date,
            default: Date.now,
            index: { expireAfterSeconds: 60 * 60 * 24 * 90 }, // TTL 90 ngày
        },
    },
    { timestamps: true }
);
chatSchema.index({ name: "text", "messages.content": "text" });
const ChatModel = mongoose.model(
    "Chats",
    chatSchema,
    "chats"
);

module.exports = ChatModel;