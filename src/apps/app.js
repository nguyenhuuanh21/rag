const express = require('express')
const app = express()
const bodyParser = require('body-parser')
const config = require('config')


app.use(bodyParser.json()); 
app.use(express.urlencoded({ extended: true }));



app.use(config.get('app.prefixApiVersion'),require('../routers/web'))
module.exports=app