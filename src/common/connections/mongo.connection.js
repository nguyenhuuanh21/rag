
const { MongoClient } = require('mongodb');
const mongoose = require("mongoose");

const mongoClient = new MongoClient(process.env.MONGODB_URI);

mongoClient.connect()
  .then(() => console.log("Connected to MongoDB Atlas successfully!"))
  .catch(err => console.error("Failed to connect to MongoDB Atlas:", err));

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("Mongoose connected"))
  .catch(err => console.error("Mongoose connection error:", err));

exports.mongoClient = mongoClient;
exports.mongoose = mongoose;