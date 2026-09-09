/**
 * Calculates discount amount based on discount type, discount value, and order amount.
 * Clamps discount between 0 and orderValue, and enforces maxDiscount if present.
 */
export const calculateCouponDiscount = (discountType, discountValue = 0, orderValue = 0, maxDiscount = null) => {
    let discount = 0;

    switch (discountType) {
        case "percentage": {
            // (orderValue * discountValue) / 100
            discount = (orderValue * Number(discountValue)) / 100;
            if (maxDiscount != null && Number(maxDiscount) > 0) {
                discount = Math.min(discount, Number(maxDiscount));
            }
            break;
        }
        case "flat":
        case "fixed": {
            discount = Number(discountValue) || 0;
            break;
        }
        default:
            throw new Error(`Invalid discount type: ${discountType}`);
    }

    // Ensure discount never exceeds orderValue and is never negative
    return Math.max(0, Math.min(discount, orderValue));
};

/**
 * Normalizes additional charges into items format without unitPrice.
 */
const normalizeAdditionalChargeItems = (additionalCharges = []) => {
    return (additionalCharges || []).map((charge) => {
        const item = {
            description: charge.description || charge.name || charge.title || "Additional Charge",
            quantity: Math.max(1, Number(charge.quantity) || 1),
            total: Number(charge.price ?? charge.amount ?? charge.total ?? 0),
        };
        return item;
    });
};

/**
 * Calculates final bill for fixed price services.
 * Final bill contains: visitCharge, items, subTotal, adjustment, adjustedTotal, discount, grandTotal, coupon, paymentStatus.
 */
export const calculateFixedPriceBill = ({
    serviceTitle = "Service",
    unitPrice = 0,
    quantity = 1,
    visitCharge = 0,
    additionalCharges = [],
    coupon = null,
}) => {
    const qty = Math.max(1, Number(quantity) || 1);
    const price = Number(unitPrice) || 0;
    const itemTotal = qty * price;

    const fixedItem = {
        description: serviceTitle || "Service",
        quantity: qty,
        unitPrice: price,
        total: itemTotal,
    };

    const addChargeItems = normalizeAdditionalChargeItems(additionalCharges);
    const items = [fixedItem, ...addChargeItems];

    const itemsTotal = items.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
    const visitChargeNum = Number(visitCharge) || 0;
    const subTotal = itemsTotal + visitChargeNum;
    const adjustment = itemsTotal >= visitChargeNum ? visitChargeNum : itemsTotal;
    const adjustedTotal = subTotal - adjustment;

    let discount = 0;
    let couponData = null;

    if (coupon && items.length > 0) {
        const minOrderValue = Number(coupon.minimumOrderValue || coupon.minimumOrdervalue) || 0;
        if (adjustedTotal >= minOrderValue) {
            discount = calculateCouponDiscount(
                coupon.discountType,
                coupon.discountValue,
                adjustedTotal,
                coupon.maxDiscount
            );
            couponData = {
                couponCode: coupon.code || coupon.couponCode || "",
                description: coupon.description || coupon.title || "",
            };
        }
    }

    const grandTotal = Math.max(0, adjustedTotal - discount);

    return {
        visitCharge: visitChargeNum,
        items,
        subTotal,
        adjustment,
        adjustedTotal,
        discount,
        grandTotal,
        coupon: couponData,
        paymentStatus: "pending",
    };
};

/**
 * Calculates final bill for visit estimate services (Pay After model).
 * Final bill contains: visitCharge, items, subTotal, adjustment, adjustedTotal, discount, grandTotal, coupon, paymentStatus.
 */
export const calculateVisitEstimateBill = ({
    serviceTitle = "Inspection / Visit Charge",
    visitCharge = 0,
    additionalCharges = [],
    coupon = null,
}) => {
    const visitChargeNum = Number(visitCharge) || 0;
    const addChargeItems = normalizeAdditionalChargeItems(additionalCharges);

    // Items list (if repairs / additional charges were performed)
    const items = addChargeItems.length > 0 ? addChargeItems : [];
    const itemsTotal = items.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
    const subTotal = itemsTotal + visitChargeNum;
    const adjustment = itemsTotal >= visitChargeNum ? visitChargeNum : itemsTotal;
    const adjustedTotal = subTotal - adjustment;

    let discount = 0;
    let couponData = null;

    // If items is empty (inspection only, no repair work/parts), coupon will NOT be applied
    if (coupon && items.length > 0) {
        const minOrderValue = Number(coupon.minimumOrderValue || coupon.minimumOrdervalue) || 0;
        if (adjustedTotal >= minOrderValue) {
            discount = calculateCouponDiscount(
                coupon.discountType,
                coupon.discountValue,
                adjustedTotal,
                coupon.maxDiscount
            );
            couponData = {
                couponCode: coupon.code || coupon.couponCode || "",
                description: coupon.description || coupon.title || "",
            };
        }
    }

    const grandTotal = Math.max(0, adjustedTotal - discount);

    return {
        visitCharge: visitChargeNum,
        items,
        subTotal,
        adjustment,
        adjustedTotal,
        discount,
        grandTotal,
        coupon: couponData,
        paymentStatus: "pending",
    };
};


