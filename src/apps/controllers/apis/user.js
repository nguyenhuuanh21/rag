const bcrypt = require("bcrypt");
const { validationResult } = require("express-validator");
const UserModel = require("../../models/user");
const jwt = require("../../../libs/jwt");
const { deleteUserToken, storeUserToken } = require("../../../libs/token.service");
const { revokeAccessToken } = require("../../../libs/redis.token");
const TokenModel = require("../../models/token");
exports.register = async (req, res) => {
  try {
    // Validate form
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        status: "error",
        message: "Validator user",
        errors: errors.array(),
      });
    }
    // Validate unique email
    const { fullName, email, password } = req.body;
    const emailExists = await UserModel.findOne({ email });
    if (emailExists)
      return res.status(400).json({
        status: "error",
        message: "Email already exists",
      });

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    // Create user
    const newUser = await UserModel.create({
      fullName,
      email,
      password: hashedPassword,
    });
    return res.status(201).json({
      status: "success",
      message: "Registered user successfully",
      data: newUser,
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};
exports.login = async (req, res) => {
  try {
    const { body } = req;
    const isEmail = await UserModel.findOne({ email: body.email });
    if (!isEmail) {
      return res.status(400).json({
        status: "error",
        message: "Email  is incorrect",
      });
    }
    const isPassword = await bcrypt.compare(body.password, isEmail.password);
    if (!isPassword) {
      return res.status(400).json({
        status: "error",
        message: "Password is incorrect",
      });
    }
    //generate token
    const accessToken = await jwt.generateAccessToken(isEmail);
    const refreshToken = await jwt.generateRefreshToken(isEmail);
    const { password, ...others } = isEmail.toObject();
    //insert token to db
    await storeUserToken(others._id, accessToken, refreshToken);

    //response token & user info
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: "None",
      maxAge: 24 * 60 * 60 * 1000,
    });
    return res.status(200).json({
      status: "success",
      message: "Login successfully",
      user: others,
      accessToken: accessToken,
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};
exports.logout = async (req, res) => {
  try {
    //move token from db to redis
    //delete token in db
    const { user } = req;
    await deleteUserToken(user.id);
    res.clearCookie("refreshToken");
    return res.status(200).json({
      status: "success",
      message: "Logout successfully",
    })

  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};
exports.refreshToken = async (req, res) => {
  try {
    const { decoded } = req
    await revokeAccessToken(decoded.id)
    const accessToken = await jwt.generateAccessToken(decoded)
    await TokenModel.updateOne({ userId: decoded.id }, { accessToken });

    return res.status(200).json({
      status: "success",
      message: "Generate access token successfully",
      accessToken: accessToken,
    })
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};