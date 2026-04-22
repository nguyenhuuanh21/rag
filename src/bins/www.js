const app = require('../apps/app')
const config = require('config')

require("dotenv").config();
const server = app.listen(port = config.get('app.serverPort'), () => {
    console.log(`Server is running on port ${port}`); 
})