import { auth } from "../config/firebase.js";
import { createUser, getUserData } from "./user.service.js";
import { AppError } from "../error/app.error.js";
import { ROLES } from "../constants/roles.js";

/**
 * Ensures phone number is in strict E.164 format for Firebase Auth (+91...)
 */
export const formatE164PhoneNumber = (phone) => {
    if (!phone) return "";
    const cleaned = String(phone).replace(/[^0-9+]/g, "");

    if (cleaned.startsWith("+")) {
        return cleaned;
    }
    // If starts with 91 and 12 digits total
    if (cleaned.length === 12 && cleaned.startsWith("91")) {
        return `+${cleaned}`;
    }
    // If standard 10 digits
    if (cleaned.length === 10) {
        return `+91${cleaned}`;
    }

    return `+${cleaned}`;
};

/**
 * Finds or creates a Firebase Auth user by phone number,
 * and ensures their Firestore user profile exists with the specified role.
 */
export const getOrCreateFirebaseAuthUser = async (phoneNumber, role = ROLES.CUSTOMER) => {
    const formattedPhone = formatE164PhoneNumber(phoneNumber);
    let authUser = null;

    try {
        authUser = await auth.getUserByPhoneNumber(formattedPhone);
    } catch (error) {
        if (error.code === "auth/user-not-found") {
            authUser = await auth.createUser({
                phoneNumber: formattedPhone,
            });
        } else {
            console.error("Firebase auth lookup error:", error);
            throw new AppError(`Authentication error: ${error.message}`, 500);
        }
    }

    const uid = authUser.uid;

    // Ensure Firestore profile exists with the specified role
    await createUser(uid, formattedPhone, role);

    return {
        uid,
        phoneNumber: formattedPhone,
    };
};

/**
 * Generates a Firebase custom token for client SDK sign-in.
 */
export const createAuthToken = async (userId) => {
    if (!userId) {
        throw new AppError("User ID is required to generate authentication token", 400);
    }
    return await auth.createCustomToken(userId);
};
