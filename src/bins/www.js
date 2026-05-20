require("dotenv").config();

const app = require('../apps/app')
const port = process.env.PORT || process.env.SERVER_PORT || 3000;
const server = app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
})