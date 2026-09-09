import crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../config/firebase.js";
import { razorpayInstance } from "../config/razorpay.js";
import { AppError } from "../error/app.error.js";

/**
 * Creates a Razorpay Order for online payment of an outstanding booking bill.
 */
export const createOnlinePaymentOrder = async ({ bookingId, userId, userRole = "customer" }) => {
    if (!bookingId) {
        throw new AppError("Booking ID is required", 400);
    }

    const bookingRef = db.collection("serviceBookings").doc(bookingId);
    const bookingSnap = await bookingRef.get();

    if (!bookingSnap.exists) {
        throw new AppError("Booking not found", 404);
    }

    const bookingData = bookingSnap.data();

    // Verify ownership
    if (userRole === "customer" && bookingData.userId !== userId) {
        throw new AppError("You are not authorized to pay for this booking", 403);
    }

    const isAlreadyPaid = (bookingData.finalBill?.paymentStatus || bookingData.paymentStatus) === "paid";
    if (isAlreadyPaid) {
        throw new AppError("Payment for this booking has already been paid", 400);
    }

    const totalPayable = bookingData.finalBill?.grandTotal;
    if (totalPayable === undefined || totalPayable === null || totalPayable <= 0) {
        throw new AppError("No outstanding bill found for this booking", 400);
    }

    // Convert amount to paise for Razorpay
    const amountInPaise = Math.round(totalPayable * 100);

    let razorpayOrder;
    try {
        razorpayOrder = await razorpayInstance.orders.create({
            amount: amountInPaise,
            currency: "INR",
            receipt: `rcpt_${bookingId.substring(0, 30)}`,
            notes: {
                bookingId,
                userId: bookingData.userId,
            },
        });
    } catch (err) {
        console.error("Razorpay order creation error:", err);
        throw new AppError(`Payment gateway error: ${err.message}`, 502);
    }

    // Record the payment intent in Firestore 'payments' collection
    const paymentRef = db.collection("payments").doc();
    await paymentRef.set({
        paymentId: paymentRef.id,
        bookingId,
        userId: bookingData.userId,
        orderId: razorpayOrder.id,
        amount: totalPayable,
        currency: "INR",
        method: "online",
        gateway: "razorpay",
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    });

    return {
        bookingId,
        orderId: razorpayOrder.id,
        amount: totalPayable,
        amountInPaise,
        currency: "INR",
        keyId: process.env.RAZORPAY_KEY_ID || "rzp_test_placeholder",
    };
};

/**
 * Reads dynamic UPI payment config from Firestore (settings/payment_config) or falls back to standard defaults
 */
export const getUpiPaymentConfig = async () => {
    try {
        const settingsDoc = await db.collection("settings").doc("payment_config").get();
        if (settingsDoc.exists) {
            const data = settingsDoc.data();
            if (data.upiId) {
                return {
                    upiId: data.upiId,
                    payeeName: data.payeeName || "SREERAJ SS",
                    isActive: data.isActive !== false,
                };
            }
        }
    } catch (err) {
        console.warn("Could not read payment_config from Firestore, using fallback:", err.message);
    }
    return {
        upiId: "8589097827@ptyes",
        payeeName: "SREERAJ SS",
        isActive: true,
    };
};

/**
 * Generates dynamic UPI details and pre-formatted UPI URI for a booking.
 */
export const getUpiPaymentDetails = async ({ bookingId, userId, userRole = "customer" }) => {
    if (!bookingId) {
        throw new AppError("Booking ID is required", 400);
    }

    const bookingRef = db.collection("serviceBookings").doc(bookingId);
    const bookingSnap = await bookingRef.get();

    if (!bookingSnap.exists) {
        throw new AppError("Booking not found", 404);
    }

    const bookingData = bookingSnap.data();

    // Verify ownership
    if (userRole === "customer" && bookingData.userId !== userId) {
        throw new AppError("You are not authorized to view payment details for this booking", 403);
    }

    const isAlreadyPaid = (bookingData.finalBill?.paymentStatus || bookingData.paymentStatus) === "paid";
    if (isAlreadyPaid) {
        throw new AppError("Payment for this booking has already been completed", 400);
    }

    const totalPayable = Number(
        bookingData.finalBill?.grandTotal ??
        bookingData.totalAmount ??
        bookingData.netPayableAmount ??
        bookingData.estimatedPrice ??
        0
    );
    if (totalPayable <= 0) {
        throw new AppError("No outstanding bill or payable amount found for this booking", 400);
    }

    const config = await getUpiPaymentConfig();
    if (config.isActive === false) {
        throw new AppError("Online UPI payment is currently disabled. Please pay cash to the professional.", 400);
    }

    const { upiId, payeeName } = config;
    const bookingNumber = bookingData.bookingCode || bookingData.bookingNumber || bookingId.substring(0, 8).toUpperCase();
    const transactionNote = `Booking ${bookingNumber}`;
    const amountStr = totalPayable.toFixed(2);

    // Standard NPCI UPI URI Scheme
    const upiUri = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(payeeName)}&am=${amountStr}&tn=${encodeURIComponent(transactionNote)}&cu=INR`;

    return {
        bookingId,
        bookingNumber,
        amount: totalPayable,
        upiId,
        payeeName,
        transactionNote,
        upiUri,
        isPaid: false,
    };
};

/**
 * Records cash or verified online payment received at doorstep.
 * Atomically updates payments collection and marks booking paymentStatus as "paid".
 */
export const recordCashPayment = async ({ bookingId, collectedBy, notes = "", method = "cash" }) => {
    if (!bookingId) {
        throw new AppError("Booking ID is required", 400);
    }

    return await db.runTransaction(async (transaction) => {
        const bookingRef = db.collection("serviceBookings").doc(bookingId);
        const bookingSnap = await transaction.get(bookingRef);

        if (!bookingSnap.exists) {
            throw new AppError("Booking not found", 404);
        }

        const bookingData = bookingSnap.data();

        const isAlreadyPaid = (bookingData.finalBill?.paymentStatus || bookingData.paymentStatus) === "paid";
        if (isAlreadyPaid) {
            throw new AppError("Payment for this booking has already been paid", 400);
        }

        const totalPayable = Number(
            bookingData.finalBill?.grandTotal ??
            bookingData.totalAmount ??
            bookingData.netPayableAmount ??
            bookingData.estimatedPrice ??
            0
        );
        if (totalPayable <= 0) {
            throw new AppError("No outstanding bill or payable amount found for this booking", 400);
        }

        const paymentMethod = method === "online" || method === "upi" ? "online" : "cash";
        const defaultNotes = paymentMethod === "online"
            ? "Payment verified online (UPI) by technician/admin"
            : "Collected as cash by technician";

        // 1. Create payment record in 'payments' collection
        const paymentRef = db.collection("payments").doc();
        transaction.set(paymentRef, {
            paymentId: paymentRef.id,
            bookingId,
            userId: bookingData.userId,
            amount: totalPayable,
            currency: "INR",
            method: paymentMethod,
            status: "paid",
            collectedBy: collectedBy || "technician",
            notes: notes || defaultNotes,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // 2. Update booking paymentStatus and finalBill.paymentStatus to "paid"
        transaction.update(bookingRef, {
            paymentStatus: "paid",
            paymentMethod: paymentMethod,
            "finalBill.paymentStatus": "paid",
            updatedAt: FieldValue.serverTimestamp(),
        });

        return {
            bookingId,
            paymentId: paymentRef.id,
            amount: totalPayable,
            method: paymentMethod,
            paymentStatus: "paid",
            message: `${paymentMethod === "online" ? "Online (UPI)" : "Cash"} payment recorded successfully and booking updated to paid`,
        };
    });
};

/**
 * Processes incoming Razorpay Webhooks.
 * Validates HMAC SHA256 signature and reconciles payment & booking status.
 */
export const processRazorpayWebhook = async ({ rawBody, signature, event }) => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (webhookSecret && signature) {
        const expectedSignature = crypto
            .createHmac("sha256", webhookSecret)
            .update(rawBody || "")
            .digest("hex");

        if (expectedSignature !== signature) {
            throw new AppError("Invalid Razorpay webhook signature", 400);
        }
    }

    const eventName = event?.event;

    // We process successful payment events
    if (eventName === "payment.captured" || eventName === "order.paid") {
        const paymentEntity = event.payload?.payment?.entity;
        const orderId = paymentEntity?.order_id;
        const bookingId = paymentEntity?.notes?.bookingId;

        if (orderId || bookingId) {
            await db.runTransaction(async (transaction) => {
                // 1. Locate and update payment document
                let paymentDocRef = null;
                let paymentData = null;

                if (orderId) {
                    const paymentQuery = await db
                        .collection("payments")
                        .where("orderId", "==", orderId)
                        .limit(1)
                        .get();

                    if (!paymentQuery.empty) {
                        paymentDocRef = paymentQuery.docs[0].ref;
                        paymentData = paymentQuery.docs[0].data();
                    }
                }

                const targetBookingId = bookingId || paymentData?.bookingId;

                if (paymentDocRef) {
                    transaction.update(paymentDocRef, {
                        status: "paid",
                        gatewayPaymentId: paymentEntity?.id || null,
                        gatewaySignature: signature || null,
                        updatedAt: FieldValue.serverTimestamp(),
                    });
                }

                // 2. Update booking document paymentStatus to "paid"
                if (targetBookingId) {
                    const bookingRef = db.collection("serviceBookings").doc(targetBookingId);
                    transaction.update(bookingRef, {
                        paymentStatus: "paid",
                        "finalBill.paymentStatus": "paid",
                        updatedAt: FieldValue.serverTimestamp(),
                    });
                }
            });
        }
    }

    return { status: "ok" };
};

/**
 * Retrieves payment records associated with a specific booking.
 */
export const getPaymentsByBookingId = async (bookingId) => {
    const snapshot = await db
        .collection("payments")
        .where("bookingId", "==", bookingId)
        .get();

    return snapshot.docs.map((doc) => doc.data());
};
