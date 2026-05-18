const { createClient } = require('redis');
const client = createClient({
    username:process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
    socket: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT
    }
});

client
    .on('error', err => console.log('Redis Client Error', err))
    .on('connect',()=>console.log('redis connected successfully'));
client.connect();



module.exports = client;