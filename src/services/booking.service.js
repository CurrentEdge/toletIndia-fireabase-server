import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { db } from "../config/firebase.js";
import { AppError } from "../error/app.error.js";
import {
    validateCoupon,
    createCouponUsage,
    redeemCouponUsage,
    deleteCouponUsage,
} from "./coupon.service.js";
import {
    calculateFixedPriceBill,
    calculateVisitEstimateBill,
} from "../utils/billing.util.js";
import {
    sendAdminBookingCreatedNotification,
    sendCustomerBookingConfirmedNotification,
} from "./notification.service.js";
import { validateLocationServiceability } from "./serviceArea.service.js";


const VISIT_CHARGE_DEFAULT = 99;

/**
 * Creates a new service booking with atomic coupon validation & reservation using Firestore transactions.
 * Supports both a single payload config object or positional arguments.
 */
export const createBooking = async (
    param1,
    serviceIdParam = null,
    quantityParam = 1,
    notesParam = "",
    couponCodeParam = null,
    addressParam = null
) => {
    let userId, serviceId, quantity, notes, couponCode, address, preferredDate, preferredTimeSlot, createdBy;

    if (typeof param1 === "object" && param1 !== null && param1.serviceId) {
        ({
            userId,
            serviceId,
            quantity = 1,
            notes = "",
            couponCode = null,
            address = {},
            preferredDate = null,
            preferredTimeSlot = null,
            createdBy = "customer",
        } = param1);
    } else {
        userId = param1;
        serviceId = serviceIdParam;
        quantity = quantityParam;
        notes = notesParam;
        couponCode = couponCodeParam;
        address = addressParam || {};
        createdBy = "customer";
    }

    if (!userId) {
        throw new AppError("User ID is required to create a booking", 400);
    }
    if (!serviceId) {
        throw new AppError("Service ID is required to create a booking", 400);
    }

    // Validate Geographical Operational Restriction
    if (address && address.latitude != null && address.longitude != null) {
        const geoCheck = await validateLocationServiceability(
            address.latitude,
            address.longitude
        );
        if (!geoCheck.isServiceable) {
            throw new AppError(
                geoCheck.message ||
                    "Service is currently not available at the selected address location.",
                400
            );
        }
    }

    const qty = Math.max(1, Number(quantity) || 1);

    // Run creation inside an atomic Firestore transaction
    const result = await db.runTransaction(async (transaction) => {
        // --- 1. READ PHASE ---
        const serviceRef = db.collection("services").doc(serviceId);
        const serviceDoc = await transaction.get(serviceRef);

        if (!serviceDoc.exists) {
            throw new AppError("Service not found", 404);
        }

        const serviceData = serviceDoc.data();
        const isFixed = serviceData.pricingModel === "fixed";
        const unitPrice = isFixed ? Number(serviceData.price) || 0 : null;
        const visitCharge = Number(serviceData.visitCharge ?? VISIT_CHARGE_DEFAULT);

        // Baseline order value for coupon qualification
        const baseOrderValue = isFixed ? qty * unitPrice : visitCharge;

        // Validate coupon atomically within transaction if couponCode provided
        let couponResult = null;
        if (couponCode) {
            couponResult = await validateCoupon({
                couponCode,
                serviceId,
                categoryId: serviceData.categoryId,
                orderValue: baseOrderValue,
                userId,
                transaction, // Read locks user usage document to prevent concurrent double-spend
            });
        }

        // Generate unique daily sequential booking number: TI-YYMMDD-XXXX
        const now = new Date();
        const yy = String(now.getFullYear()).slice(-2);
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const dd = String(now.getDate()).padStart(2, "0");
        const dateKey = `${yy}${mm}${dd}`;
        const counterRef = db.collection("counters").doc(`bookings_${dateKey}`);
        const counterSnap = await transaction.get(counterRef);
        const nextSeq = (counterSnap.exists ? (Number(counterSnap.data().count) || 0) : 0) + 1;
        const bookingNumber = `TI-${dateKey}-${String(nextSeq).padStart(4, "0")}`;

        // --- 2. WRITE PHASE ---
        const bookingRef = db.collection("serviceBookings").doc();
        const bookingId = bookingRef.id;

        const estimatedPrice = isFixed
            ? Math.max(0, qty * unitPrice - (couponResult?.computedDiscount || 0))
            : visitCharge;

        // Convert preferredDate to Firestore Timestamp
        let preferredDateTimestamp = null;
        if (preferredDate) {
            if (preferredDate instanceof Date) {
                preferredDateTimestamp = Timestamp.fromDate(preferredDate);
            } else if (typeof preferredDate === "string" || typeof preferredDate === "number") {
                const parsed = new Date(preferredDate);
                if (!isNaN(parsed.getTime())) {
                    preferredDateTimestamp = Timestamp.fromDate(parsed);
                }
            } else if (preferredDate._seconds !== undefined) {
                preferredDateTimestamp = preferredDate;
            }
        }

        // Generate a 4-digit completion code (1000 - 9999)
        const completionCode = String(Math.floor(1000 + Math.random() * 9000));

        const bookingPayload = {
            bookingId,
            bookingNumber,
            userId,
            serviceId,
            createdBy: createdBy === "admin" ? "admin" : "customer",
            serviceSnapShot: {
                serviceName: serviceData.name || "",
                categoryName: serviceData.categoryName || "",
                visitCharge,
                pricingModel: serviceData.pricingModel,
                ...(isFixed && { unitPrice }),
            },

            ...(couponResult && {
                addedCouponSnapShot: {
                    code: couponResult.couponCode,
                    description: couponResult.couponDescription,
                    minimumOrderValue: couponResult.minimumOrderValue,
                    discountType: couponResult.discountType,
                    discountValue: couponResult.discountValue,
                    maxDiscount: couponResult.maxDiscount,
                    estimatedDiscount: couponResult.computedDiscount,
                },
            }),
            quantity: qty,
            estimatedPrice,
            address: {
                recipientName: address?.recipientName || "",
                recipientPhone: address?.recipientPhone || address?.recipientphone || "",
                address: address?.address || "",
                latitude: address?.latitude ?? null,
                longitude: address?.longitude ?? null,
            },
            preferredDate: preferredDateTimestamp || FieldValue.serverTimestamp(),
            preferredTimeSlot: preferredTimeSlot || "Morning (9 AM - 12 PM)",
            notes: notes || "",
            status: "pending",
            completionCode,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };


        // 1. Write booking document
        transaction.set(bookingRef, bookingPayload);

        // 2. Update daily sequential counter
        transaction.set(
            counterRef,
            {
                count: nextSeq,
                dateKey,
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );

        // 3. Write service completion record in subcollection inside the same transaction
        const completionRef = bookingRef.collection("serviceCompletion").doc("completion");
        transaction.set(completionRef, {
            id: completionRef.id,
            bookingId,
            userId,
            completionCode,
            code: completionCode,
            isUsed: false,
            status: "active",
            createdAt: FieldValue.serverTimestamp(),
        });

        // 3. Atomically reserve coupon usage
        if (couponResult) {
            await createCouponUsage({
                userId,
                bookingId,
                couponCode: couponResult.couponCode,
                transaction,
            });

            // If coupon tracks global redemption counts, increment atomically
            if (couponResult.couponRef) {
                transaction.update(couponResult.couponRef, {
                    currentUsageCount: FieldValue.increment(1),
                });
            }
        }

        return bookingPayload;
    });

    // Notify administrators via FCM (Only if booking was created by customer)
    if (result.createdBy !== "admin") {
        try {
            await sendAdminBookingCreatedNotification(result);
        } catch (err) {
            console.warn("Failed to dispatch admin booking notification:", err.message);
        }
    }

    return result;
};


/**
 * Adds or updates additional charges (spare parts, extra labor) for a booking.
 * Callable via dedicated endpoint before completing the booking.
 */
export const updateBookingAdditionalCharges = async ({ bookingId, additionalCharges }) => {
    if (!bookingId) {
        throw new AppError("Booking ID is required", 400);
    }

    return await db.runTransaction(async (transaction) => {
        const bookingRef = db.collection("serviceBookings").doc(bookingId);
        const bookingSnap = await transaction.get(bookingRef);

        if (!bookingSnap.exists) {
            throw new AppError("Booking does not exist", 404);
        }

        const bookingData = bookingSnap.data();

        if (bookingData.status === "completed") {
            throw new AppError("Cannot add additional charges to an already completed booking", 400);
        }
        if (bookingData.status === "cancelled") {
            throw new AppError("Cannot add additional charges to a cancelled booking", 400);
        }

        const sanitizedCharges = (additionalCharges || []).map((item) => ({
            name: String(item.name).trim(),
            price: Number(item.price),
        }));

        const additionalChargesTotal = sanitizedCharges.reduce((sum, item) => sum + item.price, 0);

        transaction.update(bookingRef, {
            additionalCharges: sanitizedCharges,
            additionalChargesTotal,
            updatedAt: FieldValue.serverTimestamp(),
        });

        return {
            bookingId,
            additionalCharges: sanitizedCharges,
            additionalChargesTotal,
            message: "Additional charges updated successfully",
        };
    });
};

/**
 * Marks a booking as completed, calculates final bill using stored additionalCharges, and reconciles coupon status atomically.
 * - For fixed-price service: Can include updated final quantity.
 * - For visit-estimate service: Bill is based on visit charge + stored additionalCharges.
 */
export const markBookingAsCompleted = async ({ bookingId, completionCode = null, quantity = null }) => {
    if (!bookingId) {
        throw new AppError("Booking ID is required", 400);
    }

    return await db.runTransaction(async (transaction) => {
        // --- 1. READ PHASE ---
        const serviceBookingRef = db.collection("serviceBookings").doc(bookingId);
        const serviceBookingSnap = await transaction.get(serviceBookingRef);

        if (!serviceBookingSnap.exists) {
            throw new AppError("Booking does not exist", 404);
        }

        const bookingData = serviceBookingSnap.data();

        if (bookingData.status === "completed") {
            throw new AppError("Booking is already marked as completed", 400);
        }
        if (bookingData.status === "cancelled") {
            throw new AppError("Cannot complete a cancelled booking", 400);
        }

        // Verify completion OTP
        if (!completionCode || String(completionCode).trim().length !== 4) {
            throw new AppError("Valid 4-digit service completion OTP is required", 400);
        }

        const completionRef = serviceBookingRef.collection("serviceCompletion").doc("completion");
        const completionSnap = await transaction.get(completionRef);

        let expectedCode = null;
        let isAlreadyUsed = false;

        if (completionSnap.exists) {
            const completionData = completionSnap.data() || {};
            expectedCode = completionData.code || completionData.completionCode;
            isAlreadyUsed = completionData.isUsed === true || completionData.status === "used";
        } else if (bookingData.completionCode) {
            expectedCode = bookingData.completionCode;
        }

        if (!expectedCode) {
            throw new AppError("Service completion record not found", 404);
        }

        if (isAlreadyUsed) {
            throw new AppError("This completion OTP has already been used", 400);
        }

        if (String(expectedCode).trim() !== String(completionCode).trim()) {
            throw new AppError("Invalid completion OTP. Please enter the correct 4-digit code provided by the customer.", 400);
        }


        const serviceSnapshot = bookingData.serviceSnapShot || {};
        const couponSnapshot = bookingData.addedCouponSnapShot || bookingData.coupon || null;
        // Uses the additional charges previously saved on the booking via dedicated endpoint
        const charges = bookingData.additionalCharges || [];


        // --- 2. COMPUTE BILL ---
        let finalBill;
        if (serviceSnapshot.pricingModel === "fixed") {
            // Quantity is used only in fixed-price service calculation
            const finalQuantity = quantity !== null && quantity !== undefined ? Number(quantity) : (bookingData.quantity ?? 1);
            const serviceTitle = serviceSnapshot.serviceName || serviceSnapshot.name || serviceSnapshot.title || "Service";
            finalBill = calculateFixedPriceBill({
                serviceTitle,
                unitPrice: serviceSnapshot.unitPrice,
                quantity: finalQuantity,
                visitCharge: serviceSnapshot.visitCharge ?? VISIT_CHARGE_DEFAULT,
                additionalCharges: charges,
                coupon: couponSnapshot,
            });
        } else if (serviceSnapshot.pricingModel === "visit_estimate") {
            const serviceTitle = serviceSnapshot.serviceName || serviceSnapshot.name || serviceSnapshot.title || "Inspection / Visit Charge";
            finalBill = calculateVisitEstimateBill({
                serviceTitle,
                visitCharge: serviceSnapshot.visitCharge ?? VISIT_CHARGE_DEFAULT,
                additionalCharges: charges,
                coupon: couponSnapshot,
            });
        } else {
            throw new AppError(`Unsupported pricing model: ${serviceSnapshot.pricingModel}`, 400);
        }

        if (!finalBill || !Array.isArray(finalBill.items) || finalBill.items.length === 0) {
            throw new AppError("The booking cannot be completed since there is no item to calculate final bill", 400);
        }

        // --- 3. WRITE PHASE ---
        transaction.update(serviceBookingRef, {
            status: "completed",
            paymentStatus: "pending",
            finalBill,
            updatedAt: FieldValue.serverTimestamp(),
            completedAt: FieldValue.serverTimestamp(),
        });

        // Mark service completion code in subcollection as used
        transaction.set(
            completionRef,
            {
                isUsed: true,
                status: "used",
                usedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );

        // Reconcile coupon usage state atomically
        if (couponSnapshot?.code) {
            if (finalBill.coupon && finalBill.discount > 0) {
                await redeemCouponUsage({
                    userId: bookingData.userId,
                    couponCode: couponSnapshot.code,
                    transaction,
                });
            } else {
                // If the final total no longer qualified for the coupon, release the reservation
                await deleteCouponUsage({
                    userId: bookingData.userId,
                    couponCode: couponSnapshot.code,
                    transaction,
                });
            }
        }

        return {
            bookingId,
            status: "completed",
            paymentStatus: "pending",
            finalBill,
        };

    });
};


/**
 * Confirms a pending booking. Only technician (provider) or admin can perform this.
 */
export const confirmBooking = async ({ bookingId }) => {
    if (!bookingId) {
        throw new AppError("Booking ID is required", 400);
    }

    const result = await db.runTransaction(async (transaction) => {
        const bookingRef = db.collection("serviceBookings").doc(bookingId);
        const bookingSnap = await transaction.get(bookingRef);

        if (!bookingSnap.exists) {
            throw new AppError("Booking does not exist", 404);
        }

        const bookingData = bookingSnap.data();

        if (bookingData.status === "completed") {
            throw new AppError("Cannot confirm an already completed booking", 400);
        }
        if (bookingData.status === "cancelled") {
            throw new AppError("Cannot confirm a cancelled booking", 400);
        }
        if (bookingData.status === "confirmed") {
            throw new AppError("Booking is already confirmed", 400);
        }

        transaction.update(bookingRef, {
            status: "confirmed",
            confirmedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        return {
            bookingId,
            status: "confirmed",
            message: "Booking confirmed successfully",
            bookingData,
        };
    });

    // Notify customer via FCM
    try {
        await sendCustomerBookingConfirmedNotification({ ...result.bookingData, bookingId });
    } catch (err) {
        console.warn("Failed to dispatch customer booking confirmation notification:", err.message);
    }

    return {
        bookingId: result.bookingId,
        status: result.status,
        message: result.message,
    };
};


/**
 * Cancels a booking atomically.
 * Business Rules:
 * 1. If status is NOT "pending" (e.g. confirmed/in_progress), ONLY admin is authorized to cancel.
 * 2. Admin can optionally generate a final bill with visit charge upon cancellation.
 * 3. If status is "pending", customer or admin can cancel with no visit charge.
 * 4. Any reserved coupon is released atomically.
 */
export const cancelBooking = async ({ bookingId, userId = null, userRole = "customer", reason = "", generateFinalBill = false } = {}) => {
    if (!bookingId) {
        throw new AppError("Booking ID is required", 400);
    }

    return await db.runTransaction(async (transaction) => {
        const bookingRef = db.collection("serviceBookings").doc(bookingId);
        const bookingSnap = await transaction.get(bookingRef);

        if (!bookingSnap.exists) {
            throw new AppError("Booking does not exist", 404);
        }

        const bookingData = bookingSnap.data();

        if (bookingData.status === "completed") {
            throw new AppError("Cannot cancel an already completed booking", 400);
        }
        if (bookingData.status === "cancelled") {
            throw new AppError("Booking is already cancelled", 400);
        }

        // Rule: If booking is not pending (i.e. confirmed or in progress), only admin can cancel
        if (bookingData.status !== "pending" && userRole !== "admin") {
            throw new AppError(
                "Confirmed bookings can only be cancelled by an administrator.",
                403
            );
        }

        // Customer can only cancel their own pending booking
        if (userRole === "customer" && userId && bookingData.userId !== userId) {
            throw new AppError("You are not authorized to cancel this booking", 403);
        }

        const defaultReason = userRole === "admin" ? "Cancelled by administrator" : "Requested by customer";
        const finalReason = userRole === "customer"
            ? "Requested by customer"
            : ((typeof reason === "string" && reason.trim()) ? reason.trim() : defaultReason);

        const updateData = {
            status: "cancelled",
            cancellationReason: finalReason,
            cancelledBy: userRole || "customer",
            updatedAt: FieldValue.serverTimestamp(),
            cancelledAt: FieldValue.serverTimestamp(),
        };

        // If admin chooses to generate final bill with visit charge
        if (userRole === "admin" && generateFinalBill === true) {
            const serviceSnapshot = bookingData.serviceSnapShot || {};
            const visitFee = Number(serviceSnapshot.visitCharge ?? VISIT_CHARGE_DEFAULT) || 99;
            updateData.visitFee = visitFee;
            updateData.finalBill = {
                visitCharge: visitFee,
                items: [],
                subTotal: visitFee,
                adjustment: 0,
                discount: 0,
                total: visitFee,
                coupon: null,
            };
            updateData.paymentStatus = "pending";
        }

        transaction.update(bookingRef, updateData);

        // Release any reserved coupon atomically
        const couponSnapshot = bookingData.addedCouponSnapShot || bookingData.coupon;
        if (couponSnapshot?.code) {
            await deleteCouponUsage({
                userId: bookingData.userId,
                couponCode: couponSnapshot.code,
                transaction,
            });
        }

        return {
            bookingId,
            status: "cancelled",
            cancellationReason: updateData.cancellationReason,
            cancelledBy: updateData.cancelledBy,
            finalBill: updateData.finalBill || null,
            message: "Booking cancelled successfully",
        };
    });
};


/**
 * Returns total count of bookings made by a specific user.
 */
export const getUserBookingCount = async (userId) => {
    const snapshot = await db
        .collection("serviceBookings")
        .where("userId", "==", userId)
        .count()
        .get();
    return snapshot.data().count;
};