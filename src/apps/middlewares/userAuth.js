const jwt = require("jsonwebtoken");
const UserModel = require("../models/user");
const redisClient = require("../../common/connections/redis.connection");
exports.verifyAccessToken = async (req, res, next) => {
  try {
    const token = req.headers?.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json({
        status: "error",
        message: "access token is required",
      });
    }
    //check token in backlist token
    const isTokenBlacklisted = await redisClient.get(`tb_${token}`)
    if (isTokenBlacklisted) {
      return res.status(401).json({
        status: "error",
        message: "The token has been revoked",
      })
    }
    jwt.verify(token, process.env.JWT_ACCESS_KEY, async (err, decoded) => {
      if (err) {
        if (err.name === "TokenExpiredError") {
          return res.status(401).json({
            status: "error",
            message: "access token is expired",
          });
        }
        if (err.name === "JsonWebTokenError") {
          return res.status(401).json({
            status: "error",
            message: "Invalid access token",
          });
        }
      }
      // console.log(decoded);
      //{
      //   id: '68dbe1b978bf3adc87853cfa',
      //   email: 'a@gmail.com',
      //   iat: 1759291177,
      //   exp: 1759294777
      // }
      const user = await UserModel.findById(decoded.id).select(
        "-password"
      );
      req.user = user;
      next();
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};
exports.verifyRefreshToken = async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) {
      return res.status(401).json({
        status: "error",
        message: "refresh token is required",
      });
    }
    //check token in backlist token
    const isTokenBlacklisted = await redisClient.get(`tb_${token}`)
    if (isTokenBlacklisted) {
      return res.status(401).json({
        status: "error",
        message: "The token has been revoked",
      })
    }
    jwt.verify(token, process.env.JWT_REFRESH_KEY, async (err, decoded) => {
      if (err) {
        if (err.name === "TokenExpiredError") {
          return res.status(401).json({
            status: "error",
            message: "refresh token is expired",
          });
        }
        if (err.name === "JsonWebTokenError") {
          return res.status(401).json({
            status: "error",
            message: "Invalid refresh token",
          });
        }
      }
      req.decoded = decoded;
      next();
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};