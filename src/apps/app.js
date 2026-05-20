const express = require('express')
const app = express()
const bodyParser = require('body-parser')
const cookieParser = require('cookie-parser')
const cors = require("cors");
const redisClient = require('../common/connections/redis.connection')

app.use(cors({
    origin: (origin, callback) => {
    if (!origin || ["http://localhost:5173", 'https://rag-hdkvpcupz-anhs-projects-68c67cb7.vercel.app','https://rag-fe-theta.vercel.app'].includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
}));

app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser())


app.use(process.env.PREFIX_API_VERSION || '/api/v3', require('../routers/web'))
module.exports = app