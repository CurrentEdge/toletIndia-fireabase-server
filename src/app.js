import express from "express";
import authRoutes from "./routes/auth.route.js";
import bookingRoutes from "./routes/booking.route.js";
import couponRoutes from "./routes/coupon.route.js";
import paymentRoutes from "./routes/payment.route.js";
import adminUserRoutes from "./routes/admin_user.route.js";
import serviceAreaRoutes from "./routes/serviceArea.route.js";
import locationRoutes from "./routes/location.route.js";
import { errorMiddleware } from "./middleware/error.middleware.js";
import { requestLogger } from "./middleware/logger.middleware.js";

const app = express();

// HTTP Request Logger
app.use(requestLogger);

// Parse JSON and preserve raw buffer for payment webhook signature validation

app.use(
    express.json({
        verify: (req, res, buf) => {
            req.rawBody = buf;
        },
    })
);

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/coupons", couponRoutes);
app.use(["/api/payment", "/api/payments"], paymentRoutes);
app.use("/api/admin/users", adminUserRoutes);
app.use("/api/service-areas", serviceAreaRoutes);
app.use("/api/location", locationRoutes);



// Health Check
app.get("/health", (req, res) => {
    return res.status(200).json({
        message: "server is running",
    });
});

// 404 Handler
app.use((req, res) => {
    return res.status(404).json({
        message: "route not found",
    });
});

// Centralized Error Middleware
app.use(errorMiddleware);

export default app;
