require('dotenv').config();
module.exports = {
    app:require("./app"),
    mail:require("./mail"),
    db:require("./db")
};