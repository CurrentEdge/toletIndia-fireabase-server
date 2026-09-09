import "dotenv/config";
import { FieldValue } from "firebase-admin/firestore";
import { auth, db } from "../config/firebase.js";

/**
 * Seed script to provision or update an Administrator account with Firebase Custom Claims
 * and Firestore role record.
 *
 * Usage:
 *   node src/scripts/seedAdmin.js
 *
 * Environment variables (optional):
 *   ADMIN_EMAIL=admin@toletindia.com
 *   ADMIN_PASSWORD=AdminPassword@123
 *   ADMIN_NAME="System Administrator"
 */
async function seedAdmin() {
    const adminEmail = process.env.ADMIN_EMAIL || "admin@toletindia.in";
    const adminPassword = process.env.ADMIN_PASSWORD || "Admin@123456";
    const adminName = process.env.ADMIN_NAME || "System Administrator";


    console.log("=========================================");
    console.log("🚀 Starting Admin Seeding Process...");
    console.log(`Email: ${adminEmail}`);
    console.log("=========================================");

    try {
        let authUser;

        // 1. Check if user already exists in Firebase Auth
        try {
            authUser = await auth.getUserByEmail(adminEmail);
            console.log(`ℹ️ Existing user found with UID: ${authUser.uid}. Updating credentials...`);
            authUser = await auth.updateUser(authUser.uid, {
                password: adminPassword,
                displayName: adminName,
                emailVerified: true,
            });
        } catch (error) {
            if (error.code === "auth/user-not-found") {
                console.log("✨ User does not exist. Creating new Firebase Auth admin user...");
                authUser = await auth.createUser({
                    email: adminEmail,
                    password: adminPassword,
                    displayName: adminName,
                    emailVerified: true,
                });
            } else {
                throw error;
            }
        }

        const uid = authUser.uid;

        // 2. Set Custom User Claims on Firebase Auth token
        console.log("🔐 Assigning Custom Claims: { roles: ['admin'], admin: true }...");
        await auth.setCustomUserClaims(uid, {
            roles: ["admin"],
            admin: true,
        });

        console.log("📝 Upserting Firestore profile in 'users' collection...");
        const avatarUrl = `https://api.dicebear.com/7.x/avataaars/png?seed=${encodeURIComponent(uid)}`;
        await db.collection("users").doc(uid).set(
            {
                uid,
                email: adminEmail,
                displayName: adminName,
                avatarUrl,
                roles: ["admin"],
                updatedAt: FieldValue.serverTimestamp(),
                createdAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );

        // 4. Generate custom token for immediate testing/login
        const testCustomToken = await auth.createCustomToken(uid);

        console.log("\n=========================================");
        console.log("🎉 Admin User Provisioned Successfully!");
        console.log("-----------------------------------------");
        console.log(`UID:      ${uid}`);
        console.log(`Email:    ${adminEmail}`);
        console.log(`Password: ${adminPassword}`);
        console.log(`Role:     admin`);
        console.log("\nSample Custom Token for testing:");
        console.log(testCustomToken);
        console.log("=========================================\n");

        process.exit(0);
    } catch (err) {
        console.error("❌ Error during admin seeding:", err);
        process.exit(1);
    }
}

seedAdmin();
