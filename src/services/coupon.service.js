import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "../config/firebase.js";
import { AppError } from "../error/app.error.js";
import { calculateCouponDiscount } from "../utils/billing.util.js";

// Re-export calculateCouponDiscount for backwards-compatibility
export { calculateCouponDiscount };

/**
 * Generates a deterministic document ID for a user's coupon usage.
 * This guarantees at the database level that a user cannot concurrently double-spend a coupon.
 */
export const getCouponUsageDocId = (userId, couponCode) => {
    if (!userId || !couponCode) return null;
    return `${userId}_${couponCode.trim().toUpperCase()}`;
};

/**
 * Counts user bookings to support first-booking-only coupon validations.
 */
export const getUserBookingCount = async (userId) => {
    const snapshot = await db
        .collection("serviceBookings")
        .where("userId", "==", userId)
        .count()
        .get();
    return snapshot.data().count;
};

/**
 * Validates a coupon code against service, category, order value, and user eligibility.
 * Supports running within an existing Firestore transaction for strict atomicity.
 */
export const validateCoupon = async ({
    couponCode,
    serviceId,
    categoryId,
    orderValue = 0,
    userId,
    transaction = null,
}) => {
    if (!couponCode) {
        throw new AppError("Coupon code is required", 400);
    }

    const normalizedCode = couponCode.trim().toUpperCase();
    const now = Timestamp.now();

    // Query active coupons with matching code (avoids requiring a complex composite range index)
    const activeCouponsSnap = await db
        .collection("coupons")
        .where("code", "==", normalizedCode)
        .where("isActive", "==", true)
        .get();

    const coupons = activeCouponsSnap.docs.filter((doc) => {
        const data = doc.data();
        if (!data.validTill) return true;
        const tillMillis = data.validTill.toMillis
            ? data.validTill.toMillis()
            : new Date(data.validTill).getTime();
        return tillMillis >= now.toMillis();
    });


    if (coupons.length === 0) {
        throw new AppError("Invalid or expired coupon", 400);
    }

    const couponDoc = coupons[0];
    const couponData = couponDoc.data();
    const criteria = couponData.criteria || {};

    // 1. Global usage limit check (if configured on the coupon)
    if (couponData.totalUsageLimit != null && Number(couponData.totalUsageLimit) > 0) {
        const currentCount = Number(couponData.currentUsageCount) || 0;
        if (currentCount >= Number(couponData.totalUsageLimit)) {
            throw new AppError("Coupon usage limit has been reached", 400);
        }
    }

    // 2. Service applicability check (Only inside criteria.applicability)
    if (criteria.applicability?.type === "service") {
        const allowedServices = criteria.applicability?.applicableServiceIds;
        if (Array.isArray(allowedServices) && allowedServices.length > 0) {
            if (!serviceId || !allowedServices.includes(serviceId)) {
                throw new AppError("The coupon is not applicable to this service", 400);
            }
        }
    }

    // 3. Category applicability check (Only inside criteria.applicability)
    if (criteria.applicability?.type === "service_category") {
        const allowedCategories = criteria.applicability?.applicableCategoryIds;
        if (Array.isArray(allowedCategories) && allowedCategories.length > 0) {
            if (!categoryId || !allowedCategories.includes(categoryId)) {
                throw new AppError("The coupon is not applicable to this service category", 400);
            }
        }
    }

    // 4. First booking restriction
    if (criteria.isFirstBookingOnly) {
        if (!userId) {
            throw new AppError("User identification is required to check first-booking coupon eligibility", 401);
        }
        const bookingCount = await getUserBookingCount(userId);
        if (bookingCount > 0) {
            throw new AppError("The coupon is applicable only to your first booking", 400);
        }
    }

    // 5. Minimum order value requirement
    const minOrderValue = Number(criteria.minimumOrderValue) || 0;
    if (Number(orderValue) < minOrderValue) {
        throw new AppError(
            `Minimum order value must be at least ₹${minOrderValue} to apply this coupon`,
            400
        );
    }

    // 6. User coupon reuse check (Deterministic atomic document check if transaction provided)
    if (userId) {
        const isUsed = await checkCouponUsed({ userId, couponCode: normalizedCode, transaction });
        if (isUsed) {
            throw new AppError("Coupon has already been used or is currently applied to an active booking", 400);
        }
    }

    // Compute expected discount for this order value
    const computedDiscount = calculateCouponDiscount(
        couponData.discountType,
        couponData.discountValue,
        Number(orderValue) || 0,
        couponData.maxDiscount
    );

    return {
        couponId: couponDoc.id,
        couponRef: couponDoc.ref,
        couponCode: normalizedCode,
        couponDescription: couponData.description || "",
        discountType: couponData.discountType,
        discountValue: couponData.discountValue,
        maxDiscount: couponData.maxDiscount ?? null,
        minimumOrderValue: minOrderValue,
        computedDiscount,
    };
};

/**
 * Checks if user has an active or redeemed usage for a specific coupon code.
 * Reads via transaction if transaction is provided, ensuring transactional read consistency.
 */
export const checkCouponUsed = async ({ userId, couponCode, transaction = null }) => {
    const usageDocId = getCouponUsageDocId(userId, couponCode);
    const usageRef = db.collection("couponUsages").doc(usageDocId);

    if (transaction) {
        const docSnap = await transaction.get(usageRef);
        return docSnap.exists && docSnap.data().status !== "cancelled";
    }

    const docSnap = await usageRef.get();
    return docSnap.exists && docSnap.data().status !== "cancelled";
};

/**
 * Creates or updates a coupon usage record.
 */
export const createCouponUsage = async ({ userId, bookingId, couponCode, transaction = null }) => {
    const usageDocId = getCouponUsageDocId(userId, couponCode);
    const usageRef = db.collection("couponUsages").doc(usageDocId);

    const payload = {
        userId,
        bookingId,
        couponCode: couponCode.trim().toUpperCase(),
        status: "applied",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    };

    if (transaction) {
        transaction.set(usageRef, payload);
    } else {
        await usageRef.set(payload);
    }

    return usageRef;
};

/**
 * Marks coupon usage as "redeemed" upon booking completion.
 */
export const redeemCouponUsage = async ({ userId, couponCode, transaction = null }) => {
    const usageDocId = getCouponUsageDocId(userId, couponCode);
    const usageRef = db.collection("couponUsages").doc(usageDocId);

    const payload = {
        status: "redeemed",
        redeemedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    };

    if (transaction) {
        transaction.update(usageRef, payload);
    } else {
        await usageRef.update(payload);
    }
};

/**
 * Deletes or cancels a coupon usage record when coupon did not qualify or booking was cancelled.
 */
export const deleteCouponUsage = async ({ userId, couponCode, transaction = null }) => {
    const usageDocId = getCouponUsageDocId(userId, couponCode);
    if (!usageDocId) return;

    const usageRef = db.collection("couponUsages").doc(usageDocId);

    if (transaction) {
        transaction.delete(usageRef);
    } else {
        await usageRef.delete();
    }
};

/**
 * Creates a new coupon while guaranteeing that no active and valid coupon
 * with the same code already exists. Runs within a Firestore transaction.
 */
export const createCoupon = async ({
    code,
    title = "",
    description = "",
    discountType,
    discountValue,
    minimumOrderValue = null,
    minOrderValue = null,
    maxDiscount = null,
    criteria = {},
    totalUsageLimit = null,
    usageLimit = null,
    isFirstBookingOnly = false,
    applicableScope = "all",
    applicableServiceIds = [],
    applicableCategoryIds = [],
    validFrom = null,
    validTill = null,
    isActive = true,
    createdBy = null,
}) => {
    if (!code) {
        throw new AppError("Coupon code is required", 400);
    }

    const normalizedCode = code.trim().toUpperCase();
    const now = Timestamp.now();

    // Parse dates
    const fromTimestamp = validFrom ? Timestamp.fromDate(new Date(validFrom)) : now;
    const tillTimestamp = validTill ? Timestamp.fromDate(new Date(validTill)) : null;

    if (tillTimestamp && tillTimestamp.toMillis() <= fromTimestamp.toMillis()) {
        throw new AppError("validTill date must be strictly after validFrom date", 400);
    }

    const discValue = Number(discountValue);
    const isFlat = discountType === "flat" || discountType === "fixed";

    // Rule: For flat discount, minimumOrderValue defaults to discountValue if not provided or lower
    let minOrder =
        minimumOrderValue != null
            ? Number(minimumOrderValue)
            : minOrderValue != null
            ? Number(minOrderValue)
            : criteria?.minimumOrderValue != null
            ? Number(criteria.minimumOrderValue)
            : isFlat
            ? discValue
            : 0;

    if (isFlat && minOrder < discValue) {
        minOrder = discValue;
    }

    const finalUsageLimit =
        totalUsageLimit != null
            ? Number(totalUsageLimit)
            : usageLimit != null
            ? Number(usageLimit)
            : null;

    const firstBookingFlag = Boolean(
        isFirstBookingOnly || criteria?.isFirstBookingOnly
    );

    const applicabilityType =
        criteria?.applicability?.type || applicableScope || "all";
    const serviceIds =
        criteria?.applicability?.applicableServiceIds ||
        criteria?.applicableServiceIds ||
        applicableServiceIds ||
        [];
    const categoryIds =
        criteria?.applicability?.applicableCategoryIds ||
        criteria?.applicableCategoryIds ||
        applicableCategoryIds ||
        [];

    // Atomic transaction to ensure uniqueness among active & valid coupons
    return await db.runTransaction(async (transaction) => {
        // Find existing coupons with the same code that are currently active
        const activeCouponsQuery = db
            .collection("coupons")
            .where("code", "==", normalizedCode)
            .where("isActive", "==", true);

        const existingActiveSnap = await transaction.get(activeCouponsQuery);

        for (const doc of existingActiveSnap.docs) {
            const data = doc.data();
            // A coupon conflicts if it never expires (validTill == null) OR its expiry is still in the future
            if (data.validTill == null || data.validTill.toMillis() >= now.toMillis()) {
                throw new AppError(
                    `An active and valid coupon with code '${normalizedCode}' already exists (ID: ${doc.id})`,
                    409
                );
            }
        }

        // Create new coupon document
        const couponRef = db.collection("coupons").doc();
        const couponId = couponRef.id;

        const couponPayload = {
            couponId,
            code: normalizedCode,
            title: title ? title.trim() : `₹${discValue} Off`,
            description: description ? description.trim() : "",
            discountType,
            discountValue: discValue,
            maxDiscount: maxDiscount != null ? Number(maxDiscount) : null,
            minimumOrderValue: minOrder,
            minOrderValue: minOrder,
            criteria: {
                minimumOrderValue: minOrder,
                isFirstBookingOnly: firstBookingFlag,
                applicability: {
                    type: applicabilityType,
                    applicableServiceIds: serviceIds,
                    applicableCategoryIds: categoryIds,
                },
            },
            totalUsageLimit: finalUsageLimit,
            usageLimit: finalUsageLimit,
            currentUsageCount: 0,
            validFrom: fromTimestamp,
            validTill: tillTimestamp,
            isActive: Boolean(isActive),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            ...(createdBy && { createdBy }),
        };

        transaction.set(couponRef, couponPayload);

        return couponPayload;
    });
};

/**
 * Retrieves all coupons with optional active filter.
 */
export const getAllCoupons = async ({ activeOnly = false } = {}) => {
    let query = db.collection("coupons");
    if (activeOnly) {
        query = query.where("isActive", "==", true);
    }
    const snapshot = await query.get();
    return snapshot.docs.map((doc) => doc.data());
};

/**
 * Deactivates a coupon by ID.
 */
export const deactivateCoupon = async (couponId) => {
    const couponRef = db.collection("coupons").doc(couponId);
    const couponSnap = await couponRef.get();

    if (!couponSnap.exists) {
        throw new AppError("Coupon not found", 404);
    }

    await couponRef.update({
        isActive: false,
        updatedAt: FieldValue.serverTimestamp(),
    });

    return { message: "Coupon deactivated successfully", couponId };
};