import {
    createOnlinePaymentOrder,
    getUpiPaymentDetails,
    recordCashPayment,
    processRazorpayWebhook,
    getPaymentsByBookingId,
} from "../services/payment.service.js";
import { AppError } from "../error/app.error.js";
import { ROLES } from "../constants/roles.js";

/**
 * Controller to fetch dynamic UPI payment details (amount, payee, URI) for a booking.
 */
export const getUpiDetailsController = async (req, res) => {
    const userId = req.user?.uid;
    const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [ROLES.CUSTOMER];
    const userRole = userRoles.includes("admin")
        ? "admin"
        : userRoles.includes("technician")
        ? "technician"
        : "customer";
    const { bookingId } = req.params;

    const data = await getUpiPaymentDetails({
        bookingId,
        userId,
        userRole,
    });

    return res.status(200).json({
        message: "UPI payment details retrieved successfully",
        ...data,
    });
};

/**
 * Controller to create an online Razorpay payment order for a booking.
 */
export const createOnlineOrderController = async (req, res) => {
    const userId = req.user?.uid;
    const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [ROLES.CUSTOMER];
    const userRole = userRoles.includes("admin")
        ? "admin"
        : userRoles.includes("technician")
        ? "technician"
        : "customer";
    const { bookingId } = req.body;

    const orderData = await createOnlinePaymentOrder({
        bookingId,
        userId,
        userRole,
    });

    return res.status(200).json({
        message: "Razorpay order created successfully",
        ...orderData,
    });
};

/**
 * Controller for technicians/admins to record cash/online payment collected or verified.
 */
export const recordCashPaymentController = async (req, res) => {
    const { bookingId, notes, method } = req.body;
    const collectedBy = req.user?.uid;

    const result = await recordCashPayment({
        bookingId,
        collectedBy,
        notes,
        method: method || "cash",
    });

    return res.status(200).json(result);
};

/**
 * Webhook handler for Razorpay asynchronous payment notifications.
 */
export const razorpayWebhookController = async (req, res) => {
    const signature = req.headers["x-razorpay-signature"];
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const event = req.body;

    await processRazorpayWebhook({
        rawBody,
        signature,
        event,
    });

    return res.status(200).json({ status: "ok" });
};

/**
 * Controller to list payments for a specific booking.
 */
export const getBookingPaymentsController = async (req, res) => {
    const { bookingId } = req.params;
    if (!bookingId) {
        throw new AppError("bookingId parameter is required", 400);
    }

    const payments = await getPaymentsByBookingId(bookingId);

    return res.status(200).json({
        count: payments.length,
        payments,
    });
};
