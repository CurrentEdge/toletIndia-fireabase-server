import { db } from "../config/firebase.js";
import { FieldValue } from "firebase-admin/firestore";
import { AppError } from "../error/app.error.js";
import { ROLES } from "../constants/roles.js";

export const createUser = async (uid, phoneNumber = null, role = ROLES.CUSTOMER) => {
    const targetRole = (role && Object.values(ROLES).includes(role.toLowerCase().trim()))
        ? role.toLowerCase().trim()
        : ROLES.CUSTOMER;

    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    const dicebearAvatarUrl = `https://api.dicebear.com/7.x/avataaars/png?seed=${encodeURIComponent(uid)}`;

    if (!userSnap.exists) {
        await userRef.set({
            uid: uid,
            phoneNumber: phoneNumber,
            roles: [targetRole],
            avatarUrl: dicebearAvatarUrl,
            createdAt: FieldValue.serverTimestamp(),
        });
    } else {
        const data = userSnap.data() || {};
        const currentRoles = Array.isArray(data.roles) ? data.roles : [];
        const updates = {};

        if (!currentRoles.includes(targetRole)) {
            updates.roles = FieldValue.arrayUnion(targetRole);
        }
        if (!data.avatarUrl) {
            updates.avatarUrl = dicebearAvatarUrl;
        }

        if (Object.keys(updates).length > 0) {
            updates.updatedAt = FieldValue.serverTimestamp();
            await userRef.update(updates);
        }
    }
};

export const getUserData = async (uid) => {
    const user = await db.collection("users").doc(uid).get();
    if (!user.exists) {
        throw new AppError("User data not found", 404);
    }
    return user.data();
};

export const updateUserFcmToken = async (uid, fcmToken) => {
    if (!fcmToken || typeof fcmToken !== "string" || fcmToken.trim() === "") {
        throw new AppError("A valid fcmToken string is required", 400);
    }

    const token = fcmToken.trim();
    const userRef = db.collection("users").doc(uid);

    // Store in fcmTokens array to support multiple active devices simultaneously
    await userRef.set(
        {
            fcmTokens: FieldValue.arrayUnion(token),
            fcmUpdatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
    );


    return { message: "FCM token registered successfully" };
};

export const removeUserFcmToken = async (uid, fcmToken) => {
    if (!fcmToken || typeof fcmToken !== "string" || fcmToken.trim() === "") {
        throw new AppError("A valid fcmToken string is required", 400);
    }

    const token = fcmToken.trim();
    const userRef = db.collection("users").doc(uid);

    await userRef.set(
        {
            fcmTokens: FieldValue.arrayRemove(token),
            fcmUpdatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
    );

    return { message: "FCM token removed successfully" };
};