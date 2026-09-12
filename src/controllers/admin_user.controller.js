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

/**
 * Controller to create a new technician or upgrade an existing user to technician.
 * Accessible only by Admins.
 */
export const createTechnicianUserController = async (req, res) => {
    const { phoneNumber, name, fullName, email, address, availableServiceIds, isActive } = req.body || {};
    const technicianName = (fullName || name || "").trim();

    if (!phoneNumber || typeof phoneNumber !== "string" || !/^\+?[0-9]{10,15}$/.test(phoneNumber.trim())) {
        throw new AppError("phoneNumber is required and must be a valid 10-15 digit phone number", 400);
    }

    if (!technicianName) {
        throw new AppError("Full name (fullName) is required for technician registration", 400);
    }

    const e164Phone = formatE164PhoneNumber(phoneNumber.trim());
    const usersRef = db.collection("users");

    // 1. Check if user already exists in Firebase Auth
    let authUser = null;
    try {
        authUser = await auth.getUserByPhoneNumber(e164Phone);
    } catch (e) {
        if (e.code !== "auth/user-not-found") {
            throw new AppError(`Firebase Auth verification failed: ${e.message}`, 500);
        }
    }

    const validServices = Array.isArray(availableServiceIds) ? availableServiceIds : [];
    const activeStatus = isActive !== false;

    if (!authUser) {
        // Create new Firebase Auth user
        const createParams = {
            phoneNumber: e164Phone,
            displayName: technicianName,
        };
        if (email && typeof email === "string" && email.trim()) {
            createParams.email = email.trim();
        }

        try {
            authUser = await auth.createUser(createParams);
        } catch (err) {
            console.error("Failed to create Firebase Auth technician:", err);
            throw new AppError(`Failed to create technician account: ${err.message}`, 400);
        }

        // Create new Firestore user record with technicianProfile
        const dicebearAvatarUrl = `https://api.dicebear.com/7.x/avataaars/png?seed=${encodeURIComponent(authUser.uid)}`;
        const userProfile = {
            uid: authUser.uid,
            phoneNumber: e164Phone,
            displayName: technicianName,
            email: email && typeof email === "string" ? email.trim() : "",
            address: address && typeof address === "string" ? address.trim() : "",
            avatarUrl: dicebearAvatarUrl,
            roles: [ROLES.TECHNICIAN],
            technicianProfile: {
                fullName: technicianName,
                isActive: activeStatus,
                availableServiceIds: validServices,
                address: address && typeof address === "string" ? address.trim() : "",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            },
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };

        await usersRef.doc(authUser.uid).set(userProfile);

        return res.status(201).json({
            message: "Technician created successfully",
            user: {
                uid: authUser.uid,
                phoneNumber: e164Phone,
                displayName: userProfile.displayName,
                email: userProfile.email,
                roles: userProfile.roles,
                technicianProfile: {
                    fullName: technicianName,
                    isActive: activeStatus,
                    availableServiceIds: validServices,
                    address: userProfile.address,
                },
            },
        });
    } else {
        // Firebase Auth user already exists - check Firestore record
        const userDoc = await usersRef.doc(authUser.uid).get();

        if (userDoc.exists) {
            const data = userDoc.data() || {};
            const currentRoles = Array.isArray(data.roles) ? data.roles : [];

            if (currentRoles.includes(ROLES.TECHNICIAN) && data.technicianProfile) {
                throw new AppError(
                    `Technician profile already exists for phone number ${e164Phone}.`,
                    409
                );
            }

            // Upgrade existing user to include technician role & technicianProfile
            const updates = {
                roles: FieldValue.arrayUnion(ROLES.TECHNICIAN),
                technicianProfile: {
                    fullName: technicianName || data.displayName || data.name || "",
                    isActive: activeStatus,
                    availableServiceIds: validServices,
                    address: address && typeof address === "string" ? address.trim() : (data.address || ""),
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                },
                updatedAt: FieldValue.serverTimestamp(),
            };

            if (email && typeof email === "string" && email.trim() && !data.email) {
                updates.email = email.trim();
            }
            if (technicianName && !data.displayName) {
                updates.displayName = technicianName;
            }
            if (address && typeof address === "string" && address.trim() && !data.address) {
                updates.address = address.trim();
            }

            await usersRef.doc(authUser.uid).update(updates);

            return res.status(200).json({
                message: "User upgraded to technician successfully",
                user: {
                    uid: authUser.uid,
                    phoneNumber: e164Phone,
                    displayName: updates.displayName || data.displayName || technicianName,
                    email: updates.email || data.email || "",
                    roles: Array.from(new Set([...currentRoles, ROLES.TECHNICIAN])),
                    technicianProfile: {
                        fullName: technicianName,
                        isActive: activeStatus,
                        availableServiceIds: validServices,
                        address: address || data.address || "",
                    },
                },
            });
        } else {
            // User doc missing in Firestore -> Create it
            const dicebearAvatarUrl = `https://api.dicebear.com/7.x/avataaars/png?seed=${encodeURIComponent(authUser.uid)}`;
            const userProfile = {
                uid: authUser.uid,
                phoneNumber: e164Phone,
                displayName: technicianName || authUser.displayName || "",
                email: email && typeof email === "string" ? email.trim() : (authUser.email || ""),
                address: address && typeof address === "string" ? address.trim() : "",
                avatarUrl: authUser.photoURL || dicebearAvatarUrl,
                roles: [ROLES.TECHNICIAN],
                technicianProfile: {
                    fullName: technicianName,
                    isActive: activeStatus,
                    availableServiceIds: validServices,
                    address: address && typeof address === "string" ? address.trim() : "",
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                },
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            };

            await usersRef.doc(authUser.uid).set(userProfile);

            return res.status(201).json({
                message: "Technician profile created for existing auth user",
                user: {
                    uid: authUser.uid,
                    phoneNumber: e164Phone,
                    displayName: userProfile.displayName,
                    email: userProfile.email,
                    roles: userProfile.roles,
                    technicianProfile: {
                        fullName: technicianName,
                        isActive: activeStatus,
                        availableServiceIds: validServices,
                        address: userProfile.address,
                    },
                },
            });
        }
    }
};
