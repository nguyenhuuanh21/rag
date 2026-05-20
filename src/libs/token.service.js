const TokenModel = require("../apps/models/token");
const {addTokenBlacklist}=require("./redis.token")
exports.storeUserToken = async (userId,accessToken,refreshToken) => {
    const token = await TokenModel.findOne({ userId })
    if (token) {
        await this.deleteUserToken(userId);
    }
    await TokenModel({
        userId,
        accessToken,
        refreshToken
    }).save()
}
exports.deleteUserToken = async (userId) => { 
    const token = await TokenModel.findOne({ userId })
    if (!token) {
        const error = new Error("Token not found");
        error.status = 404;
        throw error;
    }
    //move token to redis
    await addTokenBlacklist(userId);
    //delete token from db
    await TokenModel.deleteOne({ userId });
}