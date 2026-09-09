import pinoHttp from "pino-http";
import logger from "../config/logger.js";

export const requestLogger = pinoHttp({
    logger,
    autoLogging: {
        ignore: (req) => req.url === "/health",
    },
    serializers: {
        req: (req) => ({
            id: req.id,
            method: req.method,
            url: req.url,
            query: req.query,
            params: req.params,
            remoteAddress: req.remoteAddress,
        }),
        res: (res) => ({
            statusCode: res.statusCode,
        }),
    },
    customLogLevel: (req, res, err) => {
        if (res.statusCode >= 500 || err) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
    },
    customSuccessMessage: (req, res) => {
        return `${req.method} ${req.originalUrl || req.url} - ${res.statusCode}`;
    },
    customErrorMessage: (req, res, err) => {
        return `${req.method} ${req.originalUrl || req.url} - ${res.statusCode} (${err.message})`;
    },
});
