const jwt = require('jsonwebtoken')
exports.generateAccessToken = async (payload) => await jwt.sign(
    {
        id: payload._id || payload.id,
        email: payload.email
    },
    process.env.JWT_ACCESS_KEY,
    {expiresIn:'30s'}
)
exports.generateRefreshToken = async (payload) => await jwt.sign(
    {
        id: payload._id || payload.id,
        email: payload.email
    },
    process.env.JWT_REFRESH_KEY,
    {expiresIn:'1d'}
)