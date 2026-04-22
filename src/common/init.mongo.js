const { MongoClient } = require('mongodb');
const mongoClient = new MongoClient(process.env.MONGODB_URI);
mongoClient.connect().then(() => {
    console.log("Connected to MongoDB Atlas successfully!");
}).catch(err => {
    console.error("Failed to connect to MongoDB Atlas:", err);
});

module.exports = mongoClient;