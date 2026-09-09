import { Router } from "express";
import { otpRateLimiter } from "../middleware/rateLimiter.middleware.js";
import { authMiddleWare } from "../middleware/auth.middleware.js";
import {
    validateSendOtp,
    validateVerifyOtp,
} from "../middleware/validator.middleware.js";
import {
    sendOtp,
    verifyOtp,
    getProfile,
    updateFcmTokenController,
    removeFcmTokenController,
} from "../controllers/auth.controller.js";

const router = Router();

// Send OTP to phone number (Rate limited & validated)
router.post("/send-otp", otpRateLimiter, validateSendOtp, sendOtp);

// Verify OTP & return custom auth token (Validated)
router.post("/verify-otp", validateVerifyOtp, verifyOtp);

// Get authenticated user's profile
router.get("/me", authMiddleWare, getProfile);


// Register or update device FCM token for push notifications (appends to multi-device array)
router.post("/fcm-token", authMiddleWare, updateFcmTokenController);

// Remove a device FCM token upon logout
router.delete("/fcm-token", authMiddleWare, removeFcmTokenController);



export default router;
