
const {mongoose} = require('../../common/connections/mongo.connection');
const tokenAdminSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Admins',
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
const TokenModel = mongoose.model('TokenAdmin', tokenAdminSchema, 'tokenAdmins');
module.exports = TokenModel;