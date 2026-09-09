import { AppError } from "../error/app.error.js";

/**
 * Validates request body for sending OTP.
 */
export const validateSendOtp = (req, res, next) => {
    const { phoneNumber } = req.body || {};

    if (!phoneNumber || typeof phoneNumber !== "string" || !/^\+?[0-9]{10,15}$/.test(phoneNumber.trim())) {
        throw new AppError("phoneNumber is required and must be a valid 10-15 digit phone number", 400);
    }

    next();
};

/**
 * Validates request body for verifying OTP.
 */
export const validateVerifyOtp = (req, res, next) => {
    const { code, verificationId } = req.body || {};

    if (!code || typeof code !== "string" || !/^[0-9]{4,8}$/.test(code.trim())) {
        throw new AppError("code is required and must be a 4 to 8 digit OTP code", 400);
    }

    if (!verificationId || typeof verificationId !== "string" || verificationId.trim() === "") {
        throw new AppError("verificationId is required and must be a non-empty string", 400);
    }

    next();
};





/**
 * Validates request body for creating a new booking.
 */
export const validateCreateBooking = (req, res, next) => {
    const { userId, serviceId, quantity, address, couponCode, notes } = req.body || {};

    if (userId !== undefined && (typeof userId !== "string" || userId.trim() === "")) {
        throw new AppError("userId must be a non-empty string", 400);
    }

    if (!serviceId || typeof serviceId !== "string" || serviceId.trim() === "") {
        throw new AppError("serviceId is required and must be a non-empty string", 400);
    }

    if (quantity !== undefined) {
        const parsedQty = Number(quantity);
        if (isNaN(parsedQty) || parsedQty <= 0 || !Number.isInteger(parsedQty)) {
            throw new AppError("quantity must be a positive whole integer (at least 1)", 400);
        }
    }

    if (!address || typeof address !== "object" || Array.isArray(address)) {
        throw new AppError("address object is required", 400);
    }

    const { recipientName, recipientPhone, recipientphone, address: streetAddress, latitude, longitude } = address;
    const phone = recipientPhone || recipientphone;

    if (!recipientName || typeof recipientName !== "string" || recipientName.trim() === "") {
        throw new AppError("address.recipientName is required", 400);
    }

    if (!phone || typeof phone !== "string" || !/^\+?[0-9]{10,15}$/.test(phone.trim())) {
        throw new AppError("address.recipientPhone must be a valid 10-15 digit phone number", 400);
    }

    if (!streetAddress || typeof streetAddress !== "string" || streetAddress.trim() === "") {
        throw new AppError("address.address is required", 400);
    }

    if (latitude !== undefined && latitude !== null) {
        const lat = Number(latitude);
        if (isNaN(lat) || lat < -90 || lat > 90) {
            throw new AppError("address.latitude must be a valid coordinate between -90 and 90", 400);
        }
    }

    if (longitude !== undefined && longitude !== null) {
        const lng = Number(longitude);
        if (isNaN(lng) || lng < -180 || lng > 180) {
            throw new AppError("address.longitude must be a valid coordinate between -180 and 180", 400);
        }
    }

    if (couponCode !== undefined && couponCode !== null && typeof couponCode !== "string") {
        throw new AppError("couponCode must be a string", 400);
    }

    if (notes !== undefined && notes !== null && typeof notes !== "string") {
        throw new AppError("notes must be a string", 400);
    }

    next();
};

/**
 * Validates request body for completing a booking and generating final bill.
 */
/**
 * Validates request body for adding or updating additional charges on a booking.
 */
export const validateAddAdditionalCharges = (req, res, next) => {
    const { additionalCharges } = req.body || {};

    if (!additionalCharges || !Array.isArray(additionalCharges)) {
        throw new AppError("additionalCharges is required and must be an array of charge items", 400);
    }

    if (additionalCharges.length > 10) {
        throw new AppError("Maximum of 10 additional charge items allowed per booking", 400);
    }

    let totalAdditional = 0;

    for (let i = 0; i < additionalCharges.length; i++) {
        const item = additionalCharges[i];
        if (!item || typeof item !== "object") {
            throw new AppError(`additionalCharges[${i}] must be an object`, 400);
        }
        if (!item.name || typeof item.name !== "string" || item.name.trim() === "") {
            throw new AppError(`additionalCharges[${i}].name is required and must be a non-empty string`, 400);
        }
        if (item.name.trim().length > 100) {
            throw new AppError(`additionalCharges[${i}].name cannot exceed 100 characters`, 400);
        }
        const price = Number(item.price);
        if (isNaN(price) || price < 0) {
            throw new AppError(`additionalCharges[${i}].price must be a valid non-negative number`, 400);
        }
        if (price > 50000) {
            throw new AppError(`additionalCharges[${i}].price cannot exceed ₹50,000 per item`, 400);
        }
        totalAdditional += price;
    }

    if (totalAdditional > 100000) {
        throw new AppError("Total additional charges cannot exceed ₹1,00,000", 400);
    }

    next();
};

/**
 * Validates request body for completing a booking and generating final bill.
 * Only optional quantity is accepted (applicable to fixed-price services).
 */
export const validateCompleteBooking = (req, res, next) => {
    const { quantity, completionCode } = req.body || {};

    if (!completionCode || typeof completionCode !== "string" || !/^[0-9]{4}$/.test(completionCode.trim())) {
        throw new AppError("A valid 4-digit numeric completionCode is required", 400);
    }

    if (quantity !== undefined && quantity !== null) {
        const parsedQty = Number(quantity);
        if (isNaN(parsedQty) || parsedQty <= 0 || !Number.isInteger(parsedQty)) {
            throw new AppError("quantity must be a positive integer", 400);
        }
    }

    next();
};




/**
 * Validates bookingId in request parameters.
 */
export const validateBookingIdParam = (req, res, next) => {
    const { bookingId } = req.params;
    if (!bookingId || typeof bookingId !== "string" || bookingId.trim() === "") {
        throw new AppError("bookingId parameter is required", 400);
    }
    next();
};

/**
 * Validates request body for creating a coupon.
 */
export const validateCreateCoupon = (req, res, next) => {
    const {
        code,
        discountType,
        discountValue,
        maxDiscount,
        criteria,
        totalUsageLimit,
        validFrom,
        validTill,
        isActive,
    } = req.body || {};

    if (!code || typeof code !== "string" || !/^[A-Za-z0-9_-]{3,30}$/.test(code.trim())) {
        throw new AppError(
            "code is required and must be an alphanumeric string between 3 and 30 characters (letters, numbers, _, -)",
            400
        );
    }

    if (!discountType || !["percentage", "flat"].includes(discountType)) {
        throw new AppError("discountType is required and must be either 'percentage' or 'flat'", 400);
    }

    const value = Number(discountValue);
    if (isNaN(value) || value <= 0) {
        throw new AppError("discountValue must be a positive number greater than 0", 400);
    }

    if (discountType === "percentage" && value > 100) {
        throw new AppError("discountValue for percentage discount cannot exceed 100%", 400);
    }

    if (maxDiscount !== undefined && maxDiscount !== null) {
        const max = Number(maxDiscount);
        if (isNaN(max) || max <= 0) {
            throw new AppError("maxDiscount must be a positive number", 400);
        }
    }

    if (totalUsageLimit !== undefined && totalUsageLimit !== null) {
        const limit = Number(totalUsageLimit);
        if (isNaN(limit) || limit <= 0 || !Number.isInteger(limit)) {
            throw new AppError("totalUsageLimit must be a positive integer", 400);
        }
    }

    if (criteria !== undefined) {
        if (typeof criteria !== "object" || Array.isArray(criteria)) {
            throw new AppError("criteria must be an object", 400);
        }

        if (criteria.minimumOrderValue !== undefined) {
            const minOrder = Number(criteria.minimumOrderValue);
            if (isNaN(minOrder) || minOrder < 0) {
                throw new AppError("criteria.minimumOrderValue must be a non-negative number", 400);
            }
        }

        if (criteria.applicability !== undefined) {
            const appType = criteria.applicability?.type;
            if (!["all", "service", "service_category"].includes(appType)) {
                throw new AppError(
                    "criteria.applicability.type must be one of: 'all', 'service', 'service_category'",
                    400
                );
            }

            if (appType === "service") {
                const services = criteria.applicability.applicableServiceIds;
                if (!Array.isArray(services) || services.length === 0) {
                    throw new AppError(
                        "criteria.applicability.applicableServiceIds must be a non-empty array of service IDs",
                        400
                    );
                }
            }

            if (appType === "service_category") {
                const categories = criteria.applicability.applicableCategoryIds;
                if (!Array.isArray(categories) || categories.length === 0) {
                    throw new AppError(
                        "criteria.applicability.applicableCategoryIds must be a non-empty array of category IDs",
                        400
                    );
                }
            }
        }
    }

    if (validFrom !== undefined && validFrom !== null) {
        const fromDate = new Date(validFrom);
        if (isNaN(fromDate.getTime())) {
            throw new AppError("validFrom must be a valid date or timestamp string", 400);
        }
    }

    if (validTill !== undefined && validTill !== null) {
        const tillDate = new Date(validTill);
        if (isNaN(tillDate.getTime())) {
            throw new AppError("validTill must be a valid date or timestamp string", 400);
        }
        if (tillDate.getTime() <= Date.now()) {
            throw new AppError("validTill date must be in the future", 400);
        }
    }

    if (isActive !== undefined && typeof isActive !== "boolean") {
        throw new AppError("isActive must be a boolean", 400);
    }

    next();
};

/**
 * Validates couponId in request parameters.
 */
export const validateCouponIdParam = (req, res, next) => {
    const { couponId } = req.params;
    if (!couponId || typeof couponId !== "string" || couponId.trim() === "") {
        throw new AppError("couponId parameter is required", 400);
    }
    next();
};

/**
 * Validates request body for creating an online Razorpay payment order.
 */
export const validateCreatePaymentOrder = (req, res, next) => {
    const { bookingId } = req.body || {};

    if (!bookingId || typeof bookingId !== "string" || bookingId.trim() === "") {
        throw new AppError("bookingId is required and must be a string", 400);
    }

    next();
};

/**
 * Validates request body for recording cash collected at doorstep.
 */
export const validateCashPayment = (req, res, next) => {
    const { bookingId, notes } = req.body || {};

    if (!bookingId || typeof bookingId !== "string" || bookingId.trim() === "") {
        throw new AppError("bookingId is required and must be a string", 400);
    }

    if (notes !== undefined && notes !== null && typeof notes !== "string") {
        throw new AppError("notes must be a string", 400);
    }

    next();
};


