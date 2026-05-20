require("dotenv").config();

const app = require('../apps/app')

const server = app.listen(port = process.env.SERVER_PORT || 3000, () => {
    console.log(`Server is running on port ${port}`); 
})