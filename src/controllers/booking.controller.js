import { db } from "../config/firebase.js";
import { AppError } from "../error/app.error.js";
import { ROLES } from "../constants/roles.js";
import {
    createBooking,
    confirmBooking,
    updateBookingAdditionalCharges,
    markBookingAsCompleted,
    cancelBooking,
} from "../services/booking.service.js";

/**
 * Creates a new booking for the authenticated user.
 */
export const createBookingController = async (req, res) => {
    let userId = req.user?.uid;
    if (!userId) {
        throw new AppError("Authentication required", 401);
    }

    // If Admin is creating booking on behalf of a customer
    const isAdminUser =
        req.user?.roles?.includes("admin") ||
        req.user?.admin === true;

    if (isAdminUser && req.body.userId) {
        userId = req.body.userId;
    }

    const createdBy = isAdminUser ? "admin" : "customer";

    const {
        serviceId,
        quantity,
        address,
        notes,
        couponCode,
        preferredDate,
        preferredTimeSlot,
    } = req.body;

    const booking = await createBooking({
        userId,
        serviceId,
        quantity: quantity ? Number(quantity) : 1,
        address,
        notes,
        couponCode,
        preferredDate,
        preferredTimeSlot,
        createdBy,
    });


    return res.status(201).json({
        message: "Booking created successfully",
        booking,
    });
};

/**
 * Dedicated controller to add or update additional charges (spare parts, extra labor) for a booking.
 * Only callable by technician (provider) or admin.
 */
export const updateBookingAdditionalChargesController = async (req, res) => {
    const { bookingId } = req.params;
    const { additionalCharges } = req.body || {};

    const result = await updateBookingAdditionalCharges({
        bookingId,
        additionalCharges,
    });

    return res.status(200).json(result);
};

/**
 * Marks a booking as completed and calculates final bill using stored additional charges.
 * Optional body: { quantity } (applies only to fixed-price services).
 */
export const completeBookingController = async (req, res) => {
    const { bookingId } = req.params;
    const { quantity, completionCode } = req.body || {};

    const result = await markBookingAsCompleted({
        bookingId,
        completionCode,
        quantity,
    });

    return res.status(200).json({
        message: "Booking completed successfully",
        result,
    });
};




/**
 * Confirms a pending booking (Admin or Provider only).
 */
export const confirmBookingController = async (req, res) => {
    const { bookingId } = req.params;
    const result = await confirmBooking({
        bookingId,
    });

    return res.status(200).json(result);
};

/**
 * Cancels a booking and releases any applied coupon reservation.
 * Note: If booking is confirmed, only admin can cancel. Admin can choose to generate a final bill with visit charge.
 */
export const cancelBookingController = async (req, res) => {
    const userId = req.user?.uid;
    const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [ROLES.CUSTOMER];
    const userRole = userRoles.includes("admin")
        ? "admin"
        : userRoles.includes("technician")
        ? "technician"
        : "customer";
    const { bookingId } = req.params;
    const { reason, generateFinalBill } = req.body || {};

    const result = await cancelBooking({
        bookingId,
        userId,
        userRole,
        reason,
        generateFinalBill: Boolean(generateFinalBill),
    });

    return res.status(200).json(result);
};


/**
 * Retrieves all bookings belonging to the authenticated user.
 */
export const getUserBookingsController = async (req, res) => {
    const userId = req.user?.uid;
    if (!userId) {
        throw new AppError("Authentication required", 401);
    }

    const snapshot = await db
        .collection("serviceBookings")
        .where("userId", "==", userId)
        .get();

    const bookings = snapshot.docs.map((doc) => doc.data());

    return res.status(200).json({
        count: bookings.length,
        bookings,
    });
};

/**
 * Retrieves a single booking by ID.
 */
export const getBookingByIdController = async (req, res) => {
    const userId = req.user?.uid;
    const { bookingId } = req.params;

    const doc = await db.collection("serviceBookings").doc(bookingId).get();

    if (!doc.exists) {
        throw new AppError("Booking not found", 404);
    }

    const bookingData = doc.data();

    // Verify ownership (unless user is an admin)
    const isAdmin =
        req.user?.roles?.includes("admin") ||
        req.user?.admin === true;

    if (bookingData.userId !== userId && !isAdmin) {
        throw new AppError("You are not authorized to view this booking", 403);
    }

    let completionCode = bookingData.completionCode;
    if (!completionCode) {
        const completionSnap = await db
            .collection("serviceBookings")
            .doc(bookingId)
            .collection("serviceCompletion")
            .limit(1)
            .get();
        if (!completionSnap.empty) {
            completionCode = completionSnap.docs[0].data().completionCode || completionSnap.docs[0].data().code;
        }
    }

    return res.status(200).json({
        booking: {
            ...bookingData,
            completionCode,
        },
    });
};


/**
 * Admin controller to retrieve all bookings across the platform with optional status filter.
 */
export const getAllBookingsAdminController = async (req, res) => {
    const { status } = req.query;

    let query = db.collection("serviceBookings");
    if (status) {
        query = query.where("status", "==", status);
    }

    const snapshot = await query.get();
    const bookings = snapshot.docs.map((doc) => doc.data());

    return res.status(200).json({
        count: bookings.length,
        bookings,
    });
};

