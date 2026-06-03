const bcrypt = require("bcrypt");
const { validationResult } = require("express-validator");
const UserModel = require("../../models/user");
const AdminModel = require("../../models/admin");
const jwt = require("../../../libs/jwt");
const { deleteUserToken, storeUserToken } = require("../../../libs/token.service");
const { revokeAccessToken } = require("../../../libs/redis.token");
const TokenModel = require("../../models/token");
const OtpModel = require("../../models/otp");
const crypto = require('crypto');
const sendMail = require("../../../emails/mail");
const jwtLib = require("jsonwebtoken");
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
    const emailAdminExists = await AdminModel.findOne({ email });
    if (emailExists || emailAdminExists)
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
    // Validate form
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        status: "error",
        message: "Validator user",
        errors: errors.array(),
      });
    }
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
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await UserModel.findOne({ email });
    if (!user) {
      return res.status(400).json({
        status: "error",
        message: "email không tồn tại",
      });
    }
    const existingOtp = await OtpModel.findOne({ email });
    if (existingOtp) {
      const remainingMs = existingOtp.expiresAt - Date.now();
      if (remainingMs > 0) {
        const remainingSeconds = Math.ceil(remainingMs / 1000);
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = remainingSeconds % 60;
        return res.status(429).json({
          status: "error",
          message: `OTP đã được gửi, vui lòng thử lại sau ${minutes} phút ${seconds} giây`,
        });
      }
      await OtpModel.deleteOne({ email });
    }
    const otp = crypto.randomInt(100000, 999999).toString();
    await OtpModel.create({
      email,
      otp,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    const info = await sendMail("src/emails/templates/mailOtp.ejs", {
      email,
      subject: "Khôi phục mật khẩu - OTP của bạn",
      otp,
    });
    if (!info || info[0].statusCode !== 202) {
      return res.status(500).json({
        status: "error",
        message: "Lỗi khi gửi email OTP",
        error: info,
      });
    }
    return res.status(200).json({
      status: "success",
      message: "OTP đã được gửi đến email của bạn, vui lòng kiểm tra hộp thư",
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
}
exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const storedOtp = await OtpModel.findOne({ email, otp });
    if (!storedOtp) {
      return res.status(400).json({
        status: "error",
        message: "OTP không  đúng",
      });
    }
    if (storedOtp.expiresAt < new Date()) {
      await OtpModel.deleteOne({ email, otp });
      return res.status(400).json({
        status: "error",
        message: "OTP đã hết hạn, vui lòng yêu cầu OTP mới",
      });
    }
    await OtpModel.deleteOne({ email, otp });
    const resetToken = jwtLib.sign(
      { email },
      process.env.JWT_SECRET_KEY,
      { expiresIn: '15m' }
    );

    res.cookie('resetToken', resetToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 15 * 60 * 1000, // 15 phút
    });
    return res.status(200).json({
      status: "success",
      message: "OTP verified successfully",
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
}
exports.resetPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;
    const resetToken = req.cookies?.resetToken;
    if (!resetToken) {
      return res.status(401).json({
        status: "error",
        message: "vui lòng xác thực OTP trước khi đặt lại mật khẩu",
      });
    }
    const decoded = jwtLib.verify(resetToken, process.env.JWT_SECRET_KEY);
    const user = await UserModel.findOne({ email: decoded.email });
    if (!user) {
      return res.status(400).json({
        status: "error",
        message: "email không tồn tại",
      });
    }
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.clearCookie('resetToken');
    return res.status(200).json({
      status: "success",
      message: "Đặt lại mật khẩu thành công",
    });
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({
        status: "error",
        message: "Reset token is invalid or expired",
      });
    }
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};