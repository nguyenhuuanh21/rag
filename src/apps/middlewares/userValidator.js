const { body } = require("express-validator");

exports.registerRules = [
    body("fullName").notEmpty().withMessage("tên người dùng là bắt buộc"),
    body("email")
        .notEmpty().withMessage("email là bắt buộc").bail()
        .isEmail().withMessage("email không hợp lệ"),
    body("password")
        .notEmpty().withMessage("mật khẩu là bắt buộc").bail()
        .isLength({ min: 3 }).withMessage("mật khẩu phải có ít nhất 3 ký tự"),
];

exports.loginRules = [
    body("email")
        .notEmpty().withMessage("email là bắt buộc").bail()
        .isEmail().withMessage("email không hợp lệ"),
    body("password")
        .notEmpty().withMessage("mật khẩu là bắt buộc").bail()
        .isLength({ min: 3 }).withMessage("mật khẩu phải có ít nhất 3 ký tự"),
];