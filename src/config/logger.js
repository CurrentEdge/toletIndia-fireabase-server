import pino from "pino";
import dotenv from "dotenv";
dotenv.config();

const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";

export const logger = pino({
    level: process.env.LOG_LEVEL || "info",
    redact: {
        paths: [
            "req.headers.authorization",
            "req.headers.cookie",
            "req.headers['x-api-key']",
            "req.query.key",
            "req.query.token",
            "req.body.password",
            "req.body.otp",
            "*.authorization",
            "*.password",
            "*.token",
            "*.key",
            "*.secret",
        ],
        censor: "[REDACTED]",
    },
    transport: isProduction
        ? undefined
        : {
              target: "pino-pretty",
              options: {
                  colorize: true,
                  translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
                  ignore: "pid,hostname",
              },
          },
});

export default logger;
