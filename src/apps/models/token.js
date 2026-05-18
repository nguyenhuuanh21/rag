
const {mongoose} = require('../../common/connections/mongo.connection');
const tokenSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Users',
            required: true,
        },
        accessToken: {
            type: String,
            required: true,
        },
        refreshToken: {
            type: String,
            required: true,
        }
    },
    { timestamps: true }
)
const TokenModel = mongoose.model('Token', tokenSchema, 'tokens');
module.exports = TokenModel;