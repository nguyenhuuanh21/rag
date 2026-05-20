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
    { _id: false }
);

const conversationSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Users",
            required: true,
            unique: true,
        },
        messages: {
            type: [messageSchema],
            default: [],
        },
        lastActiveAt: {
            type: Date,
            default: Date.now,
            index: { expireAfterSeconds: 60 * 60 * 24 * 90 }, // TTL 90 ngày
        },
    },
    { timestamps: true }
);
const ConversationModel = mongoose.model(
    "Conversations",
    conversationSchema,
    "conversations"
);

module.exports = ConversationModel;