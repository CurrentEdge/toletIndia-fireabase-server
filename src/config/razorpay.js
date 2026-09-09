import Razorpay from "razorpay";
import "dotenv/config";

/**
 * Razorpay instance configured with environment credentials.
 */
export const razorpayInstance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || "rzp_test_placeholder",
    key_secret: process.env.RAZORPAY_KEY_SECRET || "rzp_secret_placeholder",
});
