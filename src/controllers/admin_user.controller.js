import { auth, db } from "../config/firebase.js";
import { FieldValue } from "firebase-admin/firestore";
import { AppError } from "../error/app.error.js";
import { ROLES } from "../constants/roles.js";
import { formatE164PhoneNumber } from "../services/auth.service.js";

/**
 * Controller to search for an existing customer by phone number.
 * Accessible only by Admins.
 */
export const searchCustomerUserByPhoneController = async (req, res) => {
    const rawPhone = req.query.phone || req.query.phoneNumber;

    if (!rawPhone || typeof rawPhone !== "string" || rawPhone.trim() === "") {
        throw new AppError("Phone number query parameter 'phone' is required", 400);
    }

    const cleanedDigits = rawPhone.replace(/[^0-9]/g, "");
    if (cleanedDigits.length < 10) {
        throw new AppError("Phone number must have at least 10 digits", 400);
    }

    const e164Phone = formatE164PhoneNumber(rawPhone);
    const tenDigitPhone = cleanedDigits.slice(-10);

    // 1. Search Firestore 'users' collection
    const usersRef = db.collection("users");
    const snapshot = await usersRef
        .where("phoneNumber", "in", [e164Phone, tenDigitPhone, rawPhone.trim()])
        .limit(1)
        .get();

    if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        const data = doc.data();
        const userRoles = Array.isArray(data.roles) ? data.roles : [ROLES.CUSTOMER];
        return res.status(200).json({
            user: {
                uid: doc.id,
                phoneNumber: data.phoneNumber || e164Phone,
                displayName: data.displayName || data.name || "",
                email: data.email || "",
                roles: userRoles,
            },
        });
    }

    // 2. Fallback: Search Firebase Auth directly
    try {
        const authUser = await auth.getUserByPhoneNumber(e164Phone);
        if (authUser) {
            const dicebearAvatarUrl = `https://api.dicebear.com/7.x/avataaars/png?seed=${encodeURIComponent(authUser.uid)}`;
            const userProfile = {
                uid: authUser.uid,
                phoneNumber: authUser.phoneNumber || e164Phone,
                displayName: authUser.displayName || "",
                email: authUser.email || "",
                avatarUrl: authUser.photoURL || dicebearAvatarUrl,
                roles: [ROLES.CUSTOMER],
                createdAt: FieldValue.serverTimestamp(),
            };
            await usersRef.doc(authUser.uid).set(userProfile, { merge: true });

            return res.status(200).json({
                user: {
                    uid: authUser.uid,
                    phoneNumber: authUser.phoneNumber || e164Phone,
                    displayName: authUser.displayName || "",
                    email: authUser.email || "",
                    avatarUrl: userProfile.avatarUrl,
                    roles: [ROLES.CUSTOMER],
                },
            });
        }
    } catch (authError) {
        if (authError.code !== "auth/user-not-found") {
            console.warn("Auth search error:", authError.message);
        }
    }

    // Customer not found
    return res.status(200).json({
        user: null,
    });
};

/**
 * Controller to create a new customer in Firebase Auth & Firestore.
 * Accessible only by Admins.
 */
export const createCustomerUserController = async (req, res) => {
    const { phoneNumber, displayName, email } = req.body || {};

    if (!phoneNumber || typeof phoneNumber !== "string" || !/^\+?[0-9]{10,15}$/.test(phoneNumber.trim())) {
        throw new AppError("phoneNumber is required and must be a valid 10-15 digit phone number", 400);
    }

    const e164Phone = formatE164PhoneNumber(phoneNumber.trim());
    const cleanedDigits = phoneNumber.replace(/[^0-9]/g, "");
    const tenDigitPhone = cleanedDigits.slice(-10);

    // 1. Check if user already exists in Firebase Auth
    let existingAuthUser = null;
    try {
        existingAuthUser = await auth.getUserByPhoneNumber(e164Phone);
    } catch (e) {
        if (e.code !== "auth/user-not-found") {
            throw new AppError(`Firebase Auth verification failed: ${e.message}`, 500);
        }
    }

    if (existingAuthUser) {
        throw new AppError(
            `A user with phone number ${e164Phone} already exists. Please search for the customer instead.`,
            409
        );
    }

    // 2. Check if user already exists in Firestore 'users' collection
    const usersRef = db.collection("users");
    const existingSnap = await usersRef
        .where("phoneNumber", "in", [e164Phone, tenDigitPhone, phoneNumber.trim()])
        .limit(1)
        .get();

    if (!existingSnap.empty) {
        throw new AppError(
            `A user with phone number ${e164Phone} already exists in database.`,
            409
        );
    }

    // 3. Create Firebase Auth user
    const createParams = {
        phoneNumber: e164Phone,
    };
    if (displayName && typeof displayName === "string" && displayName.trim()) {
        createParams.displayName = displayName.trim();
    }
    if (email && typeof email === "string" && email.trim()) {
        createParams.email = email.trim();
    }

    let authUser;
    try {
        authUser = await auth.createUser(createParams);
    } catch (err) {
        console.error("Failed to create Firebase Auth user:", err);
        throw new AppError(`Failed to create user account: ${err.message}`, 400);
    }

    // 4. Create Firestore user document
    const dicebearAvatarUrl = `https://api.dicebear.com/7.x/avataaars/png?seed=${encodeURIComponent(authUser.uid)}`;
    const userProfile = {
        uid: authUser.uid,
        phoneNumber: e164Phone,
        displayName: displayName ? displayName.trim() : "",
        email: email ? email.trim() : "",
        avatarUrl: dicebearAvatarUrl,
        roles: [ROLES.CUSTOMER],
        createdAt: FieldValue.serverTimestamp(),
    };

    await usersRef.doc(authUser.uid).set(userProfile);

    return res.status(201).json({
        message: "Customer created successfully",
        user: {
            uid: authUser.uid,
            phoneNumber: e164Phone,
            displayName: userProfile.displayName,
            email: userProfile.email,
            avatarUrl: userProfile.avatarUrl,
            roles: [ROLES.CUSTOMER],
        },
    });
};
