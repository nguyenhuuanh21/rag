const {mongoose} = require("../../common/connections/mongo.connection");
const adminSchema = new mongoose.Schema(
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
const AdminModel = mongoose.model("Admins", adminSchema, "admins");
module.exports = AdminModel;