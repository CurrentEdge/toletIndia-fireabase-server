import { Ratelimit } from "@upstash/ratelimit";
import { redis, isUpstashConfigured } from "../config/upstash.js";

// 1. Initialize Upstash Rate Limiters if Redis is configured
let upstashOtpLimiter = null;
let upstashBookingLimiter = null;

if (isUpstashConfigured && redis) {
    try {
        // Send OTP: 3 requests per 10 minutes sliding window
        upstashOtpLimiter = new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(3, "10 m"),
            analytics: true,
            prefix: "ratelimit:otp",
        });

        // Make Booking: 1 request per 10 minutes sliding window
        upstashBookingLimiter = new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(1, "10 m"),
            analytics: true,
            prefix: "ratelimit:booking",
        });
    } catch (err) {
        console.warn("Error creating Upstash Ratelimit instances:", err.message);
    }
}

// 2. In-Memory Fallback Store (for local dev / before Upstash env keys are set)
const memoryStore = new Map();

const memoryRateLimit = (key, limit, windowMs) => {
    const now = Date.now();
    const record = memoryStore.get(key) || { timestamps: [] };
    
    // Filter timestamps within sliding window
    record.timestamps = record.timestamps.filter((ts) => now - ts < windowMs);
    
    if (record.timestamps.length >= limit) {
        const oldest = record.timestamps[0];
        const resetTime = oldest + windowMs;
        return {
            success: false,
            remaining: 0,
            reset: resetTime,
        };
    }

    record.timestamps.push(now);
    memoryStore.set(key, record);

    return {
        success: true,
        remaining: limit - record.timestamps.length,
        reset: now + windowMs,
    };
};

/**
 * Middleware: Rate limit Send OTP (3 requests / 10 min)
 * Key: phoneNumber || ip
 */
export const otpRateLimiter = async (req, res, next) => {
    try {
        const phone = req.body?.phoneNumber || req.body?.phone || "";
        const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1";
        const identifier = phone ? `phone:${phone}` : `ip:${clientIp}`;

        if (upstashOtpLimiter) {
            const { success, limit, remaining, reset } = await upstashOtpLimiter.limit(identifier);

            res.setHeader("X-RateLimit-Limit", limit);
            res.setHeader("X-RateLimit-Remaining", remaining);
            res.setHeader("X-RateLimit-Reset", reset);

            if (!success) {
                const retryAfterSec = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
                return res.status(429).json({
                    success: false,
                    message: `Too many OTP requests. Please try again in ${retryAfterSec} seconds.`,
                    retryAfter: retryAfterSec,
                });
            }
            return next();
        }

        // In-memory fallback: 3 requests per 10 minutes
        const windowMs = 10 * 60 * 1000;
        const result = memoryRateLimit(`otp:${identifier}`, 3, windowMs);

        if (!result.success) {
            const retryAfterSec = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
            return res.status(429).json({
                success: false,
                message: `Too many OTP requests. Please try again in ${retryAfterSec} seconds.`,
                retryAfter: retryAfterSec,
            });
        }

        return next();
    } catch (err) {
        console.error("OTP Rate limiter error:", err);
        // Fail-open on rate limiter internal error to prevent blocking valid users
        return next();
    }
};

/**
 * Middleware: Rate limit Booking Creation (1 booking / 10 min per customer)
 * Key: userId || ip
 */
export const bookingRateLimiter = async (req, res, next) => {
    try {
        const userId = req.user?.uid || req.body?.userId || "";
        const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1";
        const identifier = userId ? `user:${userId}` : `ip:${clientIp}`;

        if (upstashBookingLimiter) {
            const { success, limit, remaining, reset } = await upstashBookingLimiter.limit(identifier);

            res.setHeader("X-RateLimit-Limit", limit);
            res.setHeader("X-RateLimit-Remaining", remaining);
            res.setHeader("X-RateLimit-Reset", reset);

            if (!success) {
                const retryAfterSec = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
                const retryAfterMin = Math.ceil(retryAfterSec / 60);
                return res.status(429).json({
                    success: false,
                    message: `You can only create 1 booking every 10 minutes. Please try again in ${retryAfterMin} minute(s).`,
                    retryAfter: retryAfterSec,
                });
            }
            return next();
        }

        // In-memory fallback: 1 booking per 10 minutes
        const windowMs = 10 * 60 * 1000;
        const result = memoryRateLimit(`booking:${identifier}`, 1, windowMs);

        if (!result.success) {
            const retryAfterSec = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
            const retryAfterMin = Math.ceil(retryAfterSec / 60);
            return res.status(429).json({
                success: false,
                message: `You can only create 1 booking every 10 minutes. Please try again in ${retryAfterMin} minute(s).`,
                retryAfter: retryAfterSec,
            });
        }

        return next();
    } catch (err) {
        console.error("Booking Rate limiter error:", err);
        return next();
    }
};
