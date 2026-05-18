const {mongoose} = require("../../common/connections/mongo.connection");
const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
    },
    password: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);
const UserModel = mongoose.model("Users", userSchema, "users");
module.exports = UserModel;