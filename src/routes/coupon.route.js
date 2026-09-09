import { Router } from "express";
import { authMiddleWare, optionalAuthMiddleWare, requireAdmin } from "../middleware/auth.middleware.js";
import {
    validateCreateCoupon,
    validateCouponIdParam,
} from "../middleware/validator.middleware.js";
import {
    createCouponController,
    getAllCouponsController,
    deactivateCouponController,
    validateCouponPreviewController,
} from "../controllers/coupon.controller.js";

const router = Router();

// Preview/validate coupon for checkout (Supports optional authentication)
router.get("/validate", optionalAuthMiddleWare, validateCouponPreviewController);


// List coupons (Authenticated users / public)
router.get("/", getAllCouponsController);

// Create a new coupon (Admin only)
router.post(
    "/",
    authMiddleWare,
    requireAdmin,
    validateCreateCoupon,
    createCouponController
);

// Deactivate an existing coupon (Admin only)
router.patch(
    "/:couponId/deactivate",
    authMiddleWare,
    requireAdmin,
    validateCouponIdParam,
    deactivateCouponController
);

export default router;
