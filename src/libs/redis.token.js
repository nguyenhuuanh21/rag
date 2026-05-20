const TokenModel = require('../apps/models/token');
const {jwtDecode} = require('jwt-decode');
const redisClient  = require('../common/connections/redis.connection');
exports.revokeAccessToken = async (userId) => {
    const token = await TokenModel.findOne({ userId });
    if (!token) return;
    const decoded = jwtDecode(token.accessToken);
    if (decoded.exp > Date.now() / 1000) {
        await redisClient.set(`tb_${token.accessToken}`, 'revoked', {
            EXAT: decoded.exp
        });
    }
};
exports.addTokenBlacklist = async (userId) => {
    const token = await TokenModel.findOne({ userId });
    if (!token) {
        const error = new Error('No token found for this user');
        error.status = 400
        throw error;  
    }
    const { accessToken, refreshToken } = token;
    const decodedAccessToken = jwtDecode(accessToken);
    if (decodedAccessToken.exp > Date.now() / 1000) { 
        await redisClient.set(`tb_${accessToken}`, 'revoked', {
            EXAT:decodedAccessToken.exp 
        })
    }
    const decodedRefreshToken = jwtDecode(refreshToken);
    if (decodedRefreshToken.exp > Date.now() / 1000) {
        await redisClient.set(`tb_${refreshToken}`, 'revoked', {
            EXAT:decodedRefreshToken.exp
        })
    }
}