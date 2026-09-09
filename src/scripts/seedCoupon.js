import "dotenv/config";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { db } from "../config/firebase.js";

async function seedWelcomeCoupon() {
    console.log("=========================================");
    console.log("🎟️ Seeding WELCOME50 Coupon into Firestore...");
    console.log("=========================================");

    const couponCode = "WELCOME50";
    const now = Timestamp.now();
    const oneYearLater = Timestamp.fromDate(
        new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    );

    try {
        // Check if WELCOME50 already exists in coupons collection
        const existingQuery = await db
            .collection("coupons")
            .where("code", "==", couponCode)
            .get();

        const couponPayload = {
            code: couponCode,
            title: "Flat ₹50 Off",
            description: "Get flat ₹50 off on all services!",
            discountType: "flat",
            discountValue: 50,
            maxDiscount: null,
            minimumOrderValue: 50,
            minOrderValue: 50,
            criteria: {
                minimumOrderValue: 50,
                isFirstBookingOnly: false,
                applicability: {
                    type: "all",
                    applicableServiceIds: [],
                    applicableCategoryIds: [],
                },
            },
            totalUsageLimit: null,
            currentUsageCount: 0,
            validFrom: now,
            validTill: oneYearLater,
            isActive: true,
            updatedAt: FieldValue.serverTimestamp(),
        };

        if (!existingQuery.empty) {
            const doc = existingQuery.docs[0];
            console.log(`ℹ️ Existing coupon found with doc ID: ${doc.id}. Updating...`);
            await doc.ref.update(couponPayload);
            console.log(`✅ Coupon '${couponCode}' successfully updated! Document ID: ${doc.id}`);
        } else {
            console.log(`✨ Creating new coupon '${couponCode}'...`);
            const newDocRef = db.collection("coupons").doc();
            couponPayload.couponId = newDocRef.id;
            couponPayload.createdAt = FieldValue.serverTimestamp();
            await newDocRef.set(couponPayload);
            console.log(`✅ Coupon '${couponCode}' successfully created! Document ID: ${newDocRef.id}`);
        }

        console.log("\nCoupon Details:");
        console.log({
            code: couponPayload.code,
            discountType: couponPayload.discountType,
            discountValue: `₹${couponPayload.discountValue}`,
            minimumOrderValue: `₹${couponPayload.minimumOrderValue}`,
            applicability: "All Services",
            validTill: oneYearLater.toDate().toISOString(),
            isActive: true,
        });
        console.log("=========================================\n");
        process.exit(0);
    } catch (error) {
        console.error("❌ Failed to seed coupon:", error);
        process.exit(1);
    }
}

seedWelcomeCoupon();
