import { AxiosError } from "axios";
import { AppError } from "../error/app.error.js";
import logger from "../config/logger.js";

export const errorMiddleware = (err, req, res, next) => {
    const method = req.method;
    const url = req.originalUrl || req.url;

    if (err instanceof AppError) {
        logger.warn({ method, url, statusCode: err.statusCode, err: err.message }, `[AppError] ${err.message}`);
        return res.status(err.statusCode).json({
            message: err.message,
        });
    }

    if (err instanceof AxiosError) {
        logger.error(
            {
                method,
                url,
                axiosStatus: err.response?.status,
                axiosData: err.response?.data,
                err: err.message,
            },
            `[AxiosError] External service failure: ${err.message}`
        );
        return res.status(err.response?.status || 500).json({
            message: err.response?.data?.message || "External service error",
        });
    }

    logger.error({ method, url, stack: err.stack, err: err.message || err }, `[InternalError] ${err.message || err}`);

    return res.status(500).json({
        message: "Internal server Error!",
    });
};