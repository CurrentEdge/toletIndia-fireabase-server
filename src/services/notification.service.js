import { db, message } from "../config/firebase.js";

/**
 * Sends FCM push notification to all administrators when a new booking is created.
 */
export const sendAdminBookingCreatedNotification = async (booking) => {
    try {
        if (booking?.createdBy === "admin") {
            return { skipped: true, reason: "Booking created by admin" };
        }

        const bookingId = booking.bookingId || booking.id || "N/A";
        const bookingNumber = booking.bookingNumber || bookingId;
        const serviceName = booking.serviceSnapShot?.serviceName || "New Service";
        const customerName = booking.address?.recipientName || "A customer";

        const title = "New Service Booking";
        const body = `${customerName} booked ${serviceName} (${bookingNumber})`;

        // 1. Fetch all admin users and extract their FCM tokens
        const adminSnapshot = await db
            .collection("users")
            .where("roles", "array-contains", "admin")
            .get();

        const tokens = new Set();

        adminSnapshot.forEach((doc) => {
            const data = doc.data();
            if (Array.isArray(data.fcmTokens)) {
                data.fcmTokens.forEach((t) => {
                    if (t && typeof t === "string") tokens.add(t.trim());
                });
            } else if (data.fcmToken && typeof data.fcmToken === "string") {
                tokens.add(data.fcmToken.trim());
            }
        });

        const tokenList = Array.from(tokens).filter(Boolean);

        // 2. If admin tokens are registered, send multicast with high-priority Android & APNs configs
        if (tokenList.length > 0) {
            const response = await message.sendEachForMulticast({
                tokens: tokenList,
                notification: {
                    title,
                    body,
                },
                data: {
                    bookingId: String(bookingId),
                    bookingNumber: String(bookingNumber),
                    type: "NEW_BOOKING",
                    title: String(title),
                    body: String(body),
                    click_action: "FLUTTER_NOTIFICATION_CLICK",
                },
                android: {
                    priority: "high",
                    notification: {
                        channelId: "high_importance_channel",
                        priority: "max",
                        defaultSound: true,
                        defaultVibrateTimings: true,
                        visibility: "public",
                        clickAction: "FLUTTER_NOTIFICATION_CLICK",
                    },
                },
                apns: {
                    headers: {
                        "apns-priority": "10",
                    },
                    payload: {
                        aps: {
                            alert: {
                                title,
                                body,
                            },
                            sound: "default",
                            badge: 1,
                            contentAvailable: true,
                        },
                    },
                },
            });

            console.log(
                `🔔 Admin FCM Notification: Sent ${response.successCount}/${tokenList.length} successfully for booking ${bookingNumber} (${bookingId})`
            );

            if (response.failureCount > 0) {
                response.responses.forEach((resp, idx) => {
                    if (!resp.success) {
                        console.error(`❌ FCM Token [${tokenList[idx]}] failed:`, resp.error?.message || resp.error);
                    }
                });
            }
        } else {
            console.log("ℹ️ No admin device FCM tokens registered in database.");
        }

        // 3. Also dispatch to 'admin_bookings' topic for subscribed devices
        try {
            await message.send({
                topic: "admin_bookings",
                notification: {
                    title,
                    body,
                },
                data: {
                    bookingId: String(bookingId),
                    bookingNumber: String(bookingNumber),
                    type: "NEW_BOOKING",
                    title: String(title),
                    body: String(body),
                    click_action: "FLUTTER_NOTIFICATION_CLICK",
                },
                android: {
                    priority: "high",
                    notification: {
                        channelId: "high_importance_channel",
                        priority: "max",
                        defaultSound: true,
                        defaultVibrateTimings: true,
                    },
                },
            });
        } catch (topicErr) {
            // Optional topic fallback
        }
    } catch (error) {
        console.error("❌ Error sending admin booking notification:", error.message);
    }
};

/**
 * Sends FCM push notification to the customer when their booking is confirmed.
 */
export const sendCustomerBookingConfirmedNotification = async (booking) => {
    try {
        const bookingId = booking.bookingId || booking.id || "N/A";
        const bookingNumber = booking.bookingNumber || bookingId;
        const userId = booking.userId;
        const serviceName =
            booking.serviceSnapShot?.serviceName ||
            booking.serviceName ||
            "service booking";

        const title = "Booking Confirmed! ✅";
        const body = `Your ${serviceName} (${bookingNumber}) has been confirmed.`;

        // 1. Fetch customer user document to retrieve device FCM token(s)
        const userDoc = await db.collection("users").doc(userId).get();
        if (!userDoc.exists) {
            console.log(`ℹ️ Customer document not found for user ${userId}`);
            return;
        }

        const userData = userDoc.data();
        const tokens = new Set();

        if (Array.isArray(userData.fcmTokens)) {
            userData.fcmTokens.forEach((t) => {
                if (t && typeof t === "string") tokens.add(t.trim());
            });
        } else if (userData.fcmToken && typeof userData.fcmToken === "string") {
            tokens.add(userData.fcmToken.trim());
        }

        const tokenList = Array.from(tokens).filter(Boolean);

        if (tokenList.length === 0) {
            console.log(`ℹ️ No FCM token registered for customer ${userId}.`);
            return;
        }

        // 2. Send notification to customer's device(s) with high priority & sound
        const response = await message.sendEachForMulticast({
            tokens: tokenList,
            notification: {
                title,
                body,
            },
            data: {
                bookingId: String(bookingId),
                bookingNumber: String(bookingNumber),
                type: "BOOKING_CONFIRMED",
                title: String(title),
                body: String(body),
                click_action: "FLUTTER_NOTIFICATION_CLICK",
            },
            android: {
                priority: "high",
                notification: {
                    channelId: "high_importance_channel",
                    priority: "max",
                    defaultSound: true,
                    defaultVibrateTimings: true,
                    visibility: "public",
                    clickAction: "FLUTTER_NOTIFICATION_CLICK",
                },
            },
            apns: {
                headers: {
                    "apns-priority": "10",
                },
                payload: {
                    aps: {
                        alert: {
                            title,
                            body,
                        },
                        sound: "default",
                        badge: 1,
                        contentAvailable: true,
                    },
                },
            },
        });

        console.log(
            `🔔 Customer FCM Notification: Sent ${response.successCount}/${tokenList.length} successfully to user ${userId} ("${body}")`
        );

        if (response.failureCount > 0) {
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    console.error(`❌ FCM Token [${tokenList[idx]}] failed:`, resp.error?.message || resp.error);
                }
            });
        }
    } catch (error) {
        console.error("❌ Error sending customer booking confirmation notification:", error.message);
    }
};
