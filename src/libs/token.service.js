const TokenModel = require("../apps/models/token");
const TokenAdminModel = require("../apps/models/tokenAdmin");   
const {addTokenBlacklist,addTokenAdminBlacklist}=require("./redis.token")
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
exports.storeAdminToken = async (userId,accessToken,refreshToken) => {
    const token = await TokenAdminModel.findOne({ userId })
    if (token) {
        await this.deleteAdminToken(userId);
    }
    await TokenAdminModel({
        userId,
        accessToken,
        refreshToken
    }).save()
}
exports.deleteAdminToken = async (userId) => { 
    const token = await TokenAdminModel.findOne({ userId })
    if (!token) {
        const error = new Error("Token not found");
        error.status = 404;
        throw error;
    }
    //move token to redis
    await addTokenAdminBlacklist(userId);
    //delete token from db
    await TokenAdminModel.deleteOne({ userId });
}