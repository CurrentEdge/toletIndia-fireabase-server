import {
    createAuthToken,
    getOrCreateFirebaseAuthUser,
    formatE164PhoneNumber,
} from "../services/auth.service.js";

import { sendOtpSms, validateOtp } from "../services/otp.service.js";
import {
    getUserData,
    updateUserFcmToken,
    removeUserFcmToken,
} from "../services/user.service.js";

import { AppError } from "../error/app.error.js";
import { auth, db } from "../config/firebase.js";
import { ROLES, ALL_ROLES } from "../constants/roles.js";

/**
 * Controller to send an OTP to a phone number.
 */
export const sendOtp = async (req, res) => {
    const { phoneNumber } = req.body;

    const result = await sendOtpSms(phoneNumber);

    return res.status(200).json({
        message: "OTP sent successfully",
        verificationId: result.verificationId,
    });
};

export const verifyOtp = async (req, res) => {
    const { verificationId, role } = req.body;
    const code = req.body.code || req.body.otp;

    const targetRole = (role && ALL_ROLES.includes(role.toLowerCase().trim()))
        ? role.toLowerCase().trim()
        : ROLES.CUSTOMER;

    // 1. Validate OTP with SMS service
    const verifiedPhone = await validateOtp(code, verificationId);

    // If targetRole is technician, verify that an account already exists in Firebase Auth & Firestore
    if (targetRole === ROLES.TECHNICIAN) {
        const formattedPhone = formatE164PhoneNumber(verifiedPhone);
        let existingAuthUser = null;
        try {
            existingAuthUser = await auth.getUserByPhoneNumber(formattedPhone);
        } catch (e) {
            if (e.code === "auth/user-not-found") {
                throw new AppError("Your account not found.", 404);
            }
            throw new AppError(`Authentication check failed: ${e.message}`, 500);
        }

        if (!existingAuthUser) {
            throw new AppError("Your account not found.", 404);
        }

        const userDoc = await db.collection("users").doc(existingAuthUser.uid).get();
        if (!userDoc.exists) {
            throw new AppError("Your account not found.", 404);
        }
        const roles = Array.isArray(userDoc.data()?.roles) ? userDoc.data().roles : [];
        if (!roles.includes(ROLES.TECHNICIAN)) {
            throw new AppError("Your account not found.", 404);
        }
    }

    // 2. Get or create Firebase Auth user and ensure Firestore profile has targetRole
    const user = await getOrCreateFirebaseAuthUser(verifiedPhone, targetRole);

    // 3. Generate Firebase Custom Token
    const customToken = await createAuthToken(user.uid);

    return res.status(200).json({
        message: "OTP verified successfully",
        customToken,
        user: {
            uid: user.uid,
            phoneNumber: user.phoneNumber,
        },
    });
};

/**
 * Controller to get current authenticated user's profile.
 */
export const getProfile = async (req, res) => {
    const userId = req.user?.uid;
    if (!userId) {
        throw new AppError("Authentication required", 401);
    }

    const userData = await getUserData(userId);

    return res.status(200).json({
        user: {
            uid: userId,
            ...userData,
        },
    });
};

export const updateFcmTokenController = async (req, res) => {

    const userId = req.user?.uid;
    const { fcmToken } = req.body || {};

    if (!userId) {
        throw new AppError("Authentication required", 401);
    }

    const result = await updateUserFcmToken(userId, fcmToken);
    return res.status(200).json(result);
};

/**
 * Controller to remove device FCM token upon logout or app uninstall.
 */
export const removeFcmTokenController = async (req, res) => {
    const userId = req.user?.uid;
    const { fcmToken } = req.body || {};

    if (!userId) {
        throw new AppError("Authentication required", 401);
    }

    const result = await removeUserFcmToken(userId, fcmToken);
    return res.status(200).json(result);
};