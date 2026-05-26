const redisClient = require("../../common/connections/redis.connection");

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 20;


module.exports = async function rateLimiter(req, res, next) {
    try {
        const identifier = req.user?.id || req.ip;
        const key = `rl:chat:${identifier}`;
        const count = await redisClient.incr(key);
        if (count === 1) {
            await redisClient.expire(key, WINDOW_SECONDS);
        }
        if (count > MAX_REQUESTS) {
            return res.status(429).json({
                status: "error",
                message: `Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau ${WINDOW_SECONDS} giây.`,
            });
        }
        next();
    } catch (err) {
        console.warn("[rateLimiter] Redis error, skipping:", err.message);
        next();
    }
};
