import {
    createCoupon,
    getAllCoupons,
    deactivateCoupon,
    validateCoupon,
} from "../services/coupon.service.js";

/**
 * Controller to create a new coupon with strict active-code uniqueness.
 */
export const createCouponController = async (req, res) => {
    const coupon = await createCoupon({
        ...req.body,
        createdBy: req.user?.uid || null,
    });

    return res.status(201).json({
        message: "Coupon created successfully",
        coupon,
    });
};

/**
 * Controller to get all coupons (with optional activeOnly filter).
 */
export const getAllCouponsController = async (req, res) => {
    const activeOnly = req.query.activeOnly === "true";
    const coupons = await getAllCoupons({ activeOnly });

    return res.status(200).json({
        count: coupons.length,
        coupons,
    });
};

/**
 * Controller to deactivate a coupon.
 */
export const deactivateCouponController = async (req, res) => {
    const { couponId } = req.params;
    const result = await deactivateCoupon(couponId);
    return res.status(200).json(result);
};

/**
 * Controller to validate / preview a coupon discount for checkout.
 */
export const validateCouponPreviewController = async (req, res) => {
    const { code, serviceId, categoryId, orderValue } = req.query;

    const result = await validateCoupon({
        couponCode: code,
        serviceId,
        categoryId,
        orderValue: Number(orderValue) || 0,
        userId: req.user?.uid,
    });

    return res.status(200).json({
        valid: true,
        coupon: result,
    });
};
