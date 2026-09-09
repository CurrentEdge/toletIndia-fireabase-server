import { Redis } from "@upstash/redis";
import dotenv from "dotenv";
dotenv.config();

let redis = null;
let isUpstashConfigured = false;

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (url && token && !url.includes("placeholder")) {
    try {
        redis = new Redis({
            url,
            token,
        });
        isUpstashConfigured = true;
        console.log("✅ Upstash Redis client initialized successfully");
    } catch (err) {
        console.warn("⚠️ Failed to initialize Upstash Redis:", err.message);
    }
} else {
    console.warn("ℹ️ UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not configured in .env. Using fallback in-memory rate limiter.");
}

export { redis, isUpstashConfigured };
