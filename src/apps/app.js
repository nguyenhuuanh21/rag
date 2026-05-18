const express = require('express')
const app = express()
const bodyParser = require('body-parser')
const config = require('config')
const cookieParser = require('cookie-parser')
const cors = require("cors");
const redisClient = require('../common/connections/redis.connection')

app.use(cors({
    origin: "http://localhost:5173", 
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
}));

app.use(bodyParser.json()); 
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser())


app.use(process.env.PREFIX_API_VERSION,require('../routers/web'))
module.exports=app