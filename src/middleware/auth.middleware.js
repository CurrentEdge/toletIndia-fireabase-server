import { auth, db } from "../config/firebase.js";
import { ROLES } from "../constants/roles.js";

/**
 * Middleware that validates Firebase Bearer tokens and attaches the authenticated user to req.user.
 */
export const authMiddleWare = async (req, res, next) => {
    try {
        const header = req.headers.authorization;
        if (!header || !header.startsWith("Bearer ")) {
            return res.status(401).json({
                message: "Authentication required. Bearer token missing.",
            });
        }

        const idToken = header.substring(7).trim();
        if (!idToken) {
            return res.status(401).json({
                message: "Authentication required. Token is empty.",
            });
        }

        const decodedToken = await auth.verifyIdToken(idToken);

        // Fetch user profile from Firestore if it exists
        let userData = null;
        try {
            const userSnap = await db.collection("users").doc(decodedToken.uid).get();
            if (userSnap.exists) {
                userData = userSnap.data();
            }
        } catch (dbErr) {
            console.warn("Could not fetch user document during auth:", dbErr.message);
        }

        // Determine roles list from custom claims and Firestore profile
        const extractedRoles = new Set();

        // 1. Check custom claims
        if (Array.isArray(decodedToken.roles)) {
            decodedToken.roles.forEach((r) => {
                if (r && typeof r === "string") extractedRoles.add(r.toLowerCase().trim());
            });
        }
        if (decodedToken.admin === true) {
            extractedRoles.add(ROLES.ADMIN);
        }

        // 2. Check Firestore profile
        if (userData && Array.isArray(userData.roles)) {
            userData.roles.forEach((r) => {
                if (r && typeof r === "string") extractedRoles.add(r.toLowerCase().trim());
            });
        }

        // 3. Default to customer if no roles present
        if (extractedRoles.size === 0) {
            extractedRoles.add(ROLES.CUSTOMER);
        }

        const roles = Array.from(extractedRoles);

        req.user = {
            ...decodedToken,
            roles,
            userData,
        };

        next();
    } catch (e) {
        return res.status(401).json({
            message: "Authentication required. Invalid or expired token.",
        });
    }
};

/**
 * Optional authentication middleware: attaches req.user if a valid Bearer token is provided,
 * but allows unauthenticated requests to proceed.
 */
export const optionalAuthMiddleWare = async (req, res, next) => {
    try {
        const header = req.headers.authorization;
        if (!header || !header.startsWith("Bearer ")) {
            return next();
        }

        const idToken = header.substring(7).trim();
        if (!idToken) {
            return next();
        }

        const decodedToken = await auth.verifyIdToken(idToken);
        const extractedRoles = new Set();
        if (Array.isArray(decodedToken.roles)) {
            decodedToken.roles.forEach((r) => {
                if (r && typeof r === "string") extractedRoles.add(r.toLowerCase().trim());
            });
        }
        if (decodedToken.admin) extractedRoles.add(ROLES.ADMIN);
        if (extractedRoles.size === 0) extractedRoles.add(ROLES.CUSTOMER);

        const roles = Array.from(extractedRoles);
        req.user = {
            ...decodedToken,
            roles,
        };
        next();
    } catch (_) {
        next();
    }
};


/**
 * Role-Based Access Control (RBAC) middleware generator.
 * Allows access only if req.user has at least one of the allowed roles.
 */
export const requireRole = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                message: "Authentication required.",
            });
        }

        const userRoles = Array.isArray(req.user.roles)
            ? req.user.roles
            : [ROLES.CUSTOMER];

        const hasAllowedRole = allowedRoles.some((role) => userRoles.includes(role));

        if (!hasAllowedRole) {
            return res.status(403).json({
                message: `Access denied. Insufficient permissions. Required one of: [${allowedRoles.join(
                    ", "
                )}], but current roles are [${userRoles.join(", ")}].`,
            });
        }

        next();
    };
};

/**
 * Convenience middleware: Restricts route access to administrators only.
 */
export const requireAdmin = requireRole(ROLES.ADMIN);

/**
 * Authorization middleware for booking-specific technician/admin actions.
 * Allows access to:
 * 1. Platform Administrators (roles includes 'admin' or admin == true)
 * 2. The specific Technician assigned to this booking (via assignedTechnicianSnapShot.userId == req.user.uid)
 */
export const requireAdminOrAssignedTechnician = async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({
                message: "Authentication required.",
            });
        }

        const userRoles = Array.isArray(req.user.roles) ? req.user.roles : [ROLES.CUSTOMER];
        const isAdmin = userRoles.includes(ROLES.ADMIN) || req.user.admin === true;

        // Platform administrators have universal access
        if (isAdmin) {
            return next();
        }

        const isTechnician = userRoles.includes(ROLES.TECHNICIAN);
        if (!isTechnician) {
            return res.status(403).json({
                message: "Access denied. Only administrators or the assigned technician can perform this action.",
            });
        }

        // Extract bookingId from params or body
        const bookingId = req.params?.bookingId || req.body?.bookingId || req.query?.bookingId;
        if (!bookingId || typeof bookingId !== "string" || bookingId.trim() === "") {
            return res.status(400).json({
                message: "Booking ID is required to verify technician authorization.",
            });
        }

        // Fetch booking document to verify assigned technician
        const bookingDoc = await db.collection("serviceBookings").doc(bookingId.trim()).get();
        if (!bookingDoc.exists) {
            return res.status(404).json({
                message: "Booking not found.",
            });
        }

        const bookingData = bookingDoc.data() || {};
        const assignedTech = bookingData.assignedTechnicianSnapShot;
        const assignedTechUserId = assignedTech?.userId || assignedTech?.uid || assignedTech?.id;

        if (!assignedTechUserId || assignedTechUserId !== req.user.uid) {
            return res.status(403).json({
                message: "Access denied. You are not the assigned technician for this booking.",
            });
        }

        // Attach booking to req for downstream use
        req.booking = { id: bookingDoc.id, ...bookingData };
        next();
    } catch (err) {
        return res.status(500).json({
            message: `Authorization check failed: ${err.message}`,
        });
    }
};