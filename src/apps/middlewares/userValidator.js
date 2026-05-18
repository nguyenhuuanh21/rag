const { body } = require("express-validator");

exports.registerRules = [
    body("fullName").notEmpty().withMessage("Full name is required"),
    body("email").notEmpty().withMessage("Email is required").isEmail().withMessage("Email is invalid"),
    body("password").notEmpty().isLength({ min: 3 }).withMessage("Password must be at least 3 characters"),
]