import { FieldValue } from "firebase-admin/firestore";
import { db } from "../config/firebase.js";

async function seedPaymentConfig() {
    console.log("=== Seeding payment_config to Firestore ===");

    const paymentConfigRef = db.collection("settings").doc("payment_config");
    const existing = await paymentConfigRef.get();

    const configData = {
        upiId: "8589097827@ptyes",
        payeeName: "SREERAJ SS",
        isActive: true,
        updatedAt: FieldValue.serverTimestamp(),
    };

    if (!existing.exists) {
        configData.createdAt = FieldValue.serverTimestamp();
        await paymentConfigRef.set(configData);
        console.log("✅ Created new document `settings/payment_config`:", configData);
    } else {
        await paymentConfigRef.set(configData);
        console.log("✅ Updated existing document `settings/payment_config` (without merchantCategoryCode):", configData);
    }

    const verifySnap = await paymentConfigRef.get();
    console.log("Verified Firestore Data:", verifySnap.data());
    console.log("=== Payment Config Seeded Successfully! ===");
}

seedPaymentConfig()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("Seeding payment_config failed:", err);
        process.exit(1);
    });
