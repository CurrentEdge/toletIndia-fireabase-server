import { Router } from "express";
import {
    authMiddleWare,
    requireRole,
    requireAdmin,
    requireAdminOrAssignedTechnician,
} from "../middleware/auth.middleware.js";
import {
    validateCreateBooking,
    validateCompleteBooking,
    validateBookingIdParam,
    validateAddAdditionalCharges,
} from "../middleware/validator.middleware.js";
import { bookingRateLimiter } from "../middleware/rateLimiter.middleware.js";
import {
    createBookingController,
    confirmBookingController,
    updateBookingAdditionalChargesController,
    completeBookingController,
    cancelBookingController,
    getUserBookingsController,
    getBookingByIdController,
    getAllBookingsAdminController,
} from "../controllers/booking.controller.js";

const router = Router();

// Protect all booking routes with authentication
router.use(authMiddleWare);

// Admin: Get all bookings across the platform
router.get("/admin/all", requireAdmin, getAllBookingsAdminController);

// Customer: Create a new booking (Rate limited to 1 per 10 minutes)
router.post("/", bookingRateLimiter, validateCreateBooking, createBookingController);

// Customer: Get list of bookings for the authenticated user
router.get("/", getUserBookingsController);

// Customer/Admin: Get a single booking by ID
router.get("/:bookingId", validateBookingIdParam, getBookingByIdController);

// Admin/Assigned Technician: Confirm a pending booking
router.patch(
    "/:bookingId/confirm",
    validateBookingIdParam,
    requireAdminOrAssignedTechnician,
    confirmBookingController
);

// Admin/Assigned Technician: Add or update additional charges (spare parts, extra labor) on-site
router.post(
    ["/:bookingId/charges", "/:bookingId/additional-charges"],
    validateBookingIdParam,
    validateAddAdditionalCharges,
    requireAdminOrAssignedTechnician,
    updateBookingAdditionalChargesController
);


// Admin/Assigned Technician: Mark booking as completed and compute final bill
router.post(
    "/:bookingId/complete",
    validateBookingIdParam,
    validateCompleteBooking,
    requireAdminOrAssignedTechnician,
    completeBookingController
);

// Customer/Admin/Technician: Cancel a booking (Customer only if pending; Admin/Technician anytime with visit charge if confirmed)
router.post("/:bookingId/cancel", validateBookingIdParam, cancelBookingController);


export default router;

