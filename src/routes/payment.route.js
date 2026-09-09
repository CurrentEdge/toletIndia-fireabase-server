import { Router } from "express";
import { authMiddleWare, requireRole, requireAdminOrAssignedTechnician } from "../middleware/auth.middleware.js";
import {
    validateCreatePaymentOrder,
    validateCashPayment,
    validateBookingIdParam,
} from "../middleware/validator.middleware.js";
import {
    getUpiDetailsController,
    createOnlineOrderController,
    recordCashPaymentController,
    razorpayWebhookController,
    getBookingPaymentsController,
} from "../controllers/payment.controller.js";

const router = Router();

// Customer/Admin: Fetch dynamic UPI payment details (amount, payee, UPI URI)
router.get(
    "/upi-details/:bookingId",
    authMiddleWare,
    validateBookingIdParam,
    getUpiDetailsController
);

// Customer: Create Razorpay order to pay for an outstanding completed booking
router.post(
    "/create-order",
    authMiddleWare,
    validateCreatePaymentOrder,
    createOnlineOrderController
);

// Admin or Assigned Technician: Record cash received at doorstep
router.post(
    "/cash-collection",
    authMiddleWare,
    validateCashPayment,
    requireAdminOrAssignedTechnician,
    recordCashPaymentController
);

// Public: Razorpay Webhook endpoint for asynchronous payment updates
router.post("/webhook", razorpayWebhookController);

// Authenticated: Get payment history for a specific booking
router.get(
    "/booking/:bookingId",
    authMiddleWare,
    validateBookingIdParam,
    getBookingPaymentsController
);

export default router;
