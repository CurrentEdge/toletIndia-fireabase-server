# ToletIndia Backend API Documentation

## Overview

The ToletIndia Firebase Server provides authentication, service bookings, dynamic billing, and coupon lifecycle management. It uses Firebase Authentication for identity, Cloud Firestore with ACID transactions for data consistency, and Message Central CPaaS for SMS OTP verification.

---

## 1. Authentication & Authorization Architecture

### 1.1 Two Authentication Models

```
                                 [ CUSTOMER ]
                                      │
                         Phone Number + SMS OTP
                                      │
                     POST /api/auth/send-otp & verify-otp
                                      │
                           Role: "customer" (Default)
                                      ▼
                      ┌───────────────────────────────┐
                      │    Firebase Auth Token        │
                      │  (Custom Token -> ID Token)   │
                      └──────────────┬────────────────┘
                                     │
                                     │  Authorization: Bearer <idToken>
                                     ▼
                      ┌───────────────────────────────┐
                      │    API Protected Endpoints    │
                      └──────────────┬────────────────┘
                                     ▲
                                     │  Authorization: Bearer <idToken>
                                     │
                               Role: "admin"
                                     │
                        Email + Password / Claims
                                     │
                                 [ ADMIN ]
```

1. **Customers (Phone OTP)**:
   - Request an OTP via `POST /api/auth/send-otp`.
   - Verify OTP via `POST /api/auth/verify-otp`.
   - The backend checks or provisions a Firebase Auth user, creates their Firestore `users` profile, and returns a Firebase Custom Token.
   - The client SDK calls `signInWithCustomToken(customToken)` to exchange it for an `idToken`.

2. **Administrators (Email & Password)**:
   - Seeded into Firebase Auth with Custom Claims: `{ role: "admin", admin: true }`.
   - Sign in directly using Firebase Client SDK (`signInWithEmailAndPassword`) or via the backend `POST /api/auth/admin-login` endpoint.
   - The resulting ID token contains `role: "admin"`, granting access to administrative operations.

### 1.2 Roles & RBAC Matrix

| Role | Description | Permissions |
| :--- | :--- | :--- |
| **`customer`** | Normal customer/user | Create bookings, view own bookings, cancel own bookings, preview coupons. |
| **`admin`** | System administrator | All customer permissions + create coupons, deactivate coupons, view all bookings, mark bookings completed. |
| **`provider`** | Service technician / provider | Complete assigned service bookings, view assigned jobs. |

### 1.3 HTTP Headers

All protected endpoints require the Firebase ID Token passed in the `Authorization` header:

```http
Authorization: Bearer <FIREBASE_ID_TOKEN>
Content-Type: application/json
```

---

## 2. Administrator Provisioning (Seed Script)

To create or update the initial administrator account with custom claims:

```bash
# Run with default credentials (admin@toletindia.com / Admin@123456)
npm run seed:admin

# Or supply custom credentials via environment variables:
ADMIN_EMAIL=myadmin@toletindia.com ADMIN_PASSWORD=StrongPassword123 npm run seed:admin
```

This script:
1. Creates the user in Firebase Auth (or updates their password if already existing).
2. Sets Firebase Custom Claims: `{ role: "admin", admin: true }`.
3. Upserts their Firestore document in `users/${uid}` with `{ role: "admin" }`.
4. Outputs a test custom token for immediate API testing.

---

## 3. API Endpoints Reference

### 3.1 Authentication Endpoints (`/api/auth`)

---

#### `POST /api/auth/send-otp`
Sends a one-time SMS verification code to the customer's phone number. Rate-limited to 2 requests per 15 minutes per IP.

- **Access**: Public
- **Request Body**:
```json
{
  "phoneNumber": "9995216594"
}
```
- **Response (200 OK)**:
```json
{
  "message": "OTP sent successfully",
  "verificationId": "15415902"
}
```

---

#### `POST /api/auth/verify-otp`
Verifies the submitted OTP code. If valid, provisions the Firebase user and returns an authentication token.

- **Access**: Public
- **Request Body**:
```json
{
  "verificationId": "15415902",
  "code": "5998"
}
```
- **Response (200 OK)**:
```json
{
  "message": "OTP verified successfully",
  "customToken": "eyJhbGciOiJIUzUxMiJ9...",
  "user": {
    "uid": "abc123firebaseUid",
    "phoneNumber": "+919995216594"
  }
}
```

---

#### `POST /api/auth/admin-login`
Authenticates an administrator with email and password and returns their admin token.

- **Access**: Public
- **Request Body**:
```json
{
  "email": "admin@toletindia.com",
  "password": "Admin@123456"
}
```
- **Response (200 OK)**:
```json
{
  "message": "Admin authentication successful",
  "customToken": "eyJhbGciOiJIUzUxMiJ9...",
  "user": {
    "uid": "adminUid123",
    "email": "admin@toletindia.com",
    "displayName": "System Administrator",
    "role": "admin"
  }
}
```

---

#### `GET /api/auth/me`
Retrieves the profile of the currently authenticated user.

- **Access**: Authenticated (`customer`, `admin`, `provider`)
- **Headers**: `Authorization: Bearer <ID_TOKEN>`
- **Response (200 OK)**:
```json
{
  "user": {
    "uid": "abc123firebaseUid",
    "phoneNumber": "+919995216594",
    "role": "customer",
    "createdAt": "2026-09-01T10:00:00.000Z"
  }
}
```

---

#### `POST /api/auth/fcm-token`
Registers or updates the client device's Firebase Cloud Messaging (FCM) push notification token in the user's profile.

- **Access**: Authenticated (`customer`, `admin`, `provider`)
- **Headers**: `Authorization: Bearer <ID_TOKEN>`
- **Request Body**:
```json
{
  "fcmToken": "eK...dL:APA91bF..."
}
```
- **Response (200 OK)**:
```json
{
  "message": "FCM token registered successfully"
}
```

---

### FCM Push Notification Automation

The backend automatically sends Firebase Cloud Messaging (FCM) notifications for key lifecycle events:

1. **When a Booking is Created (`POST /api/bookings`)**:
   - Sends push notification to **all Administrators** (`role: "admin"`) with device FCM tokens and to the `admin_bookings` topic:
     - **Title**: `New Booking Received! 🛎️`
     - **Body**: `{CustomerName} booked {ServiceName} (ID: {BookingId}).`
     - **Data**: `{ bookingId, type: "NEW_BOOKING" }`

2. **When a Booking is Confirmed (`PATCH /api/bookings/:bookingId/confirm`)**:
   - Sends push notification directly to the **Customer's device(s)**:
     - **Title**: `Booking Confirmed! ✅`
     - **Body**: `Your booking for {ServiceName} (ID: {BookingId}) has been confirmed by the technician.`
     - **Data**: `{ bookingId, type: "BOOKING_CONFIRMED" }`


---

### 3.2 Booking Endpoints (`/api/bookings`)

---

#### `POST /api/bookings`
Creates a new service booking inside an atomic Firestore transaction, reserving any valid coupon.

- **Access**: Authenticated (`customer`)
- **Headers**: `Authorization: Bearer <ID_TOKEN>`
- **Request Body**:
```json
{
  "serviceId": "srv_ac_repair_01",
  "quantity": 1,
  "couponCode": "SAVE50",
  "notes": "Please call before arriving",
  "address": {
    "recipientName": "Rahul Sharma",
    "recipientPhone": "+919876543210",
    "address": "Flat 402, Green Valley Apartments, MG Road, Bengaluru",
    "latitude": 12.9716,
    "longitude": 77.5946
  }
}
```
- **Response (201 Created)**:
```json
{
  "message": "Booking created successfully",
  "booking": {
    "bookingId": "bk_789xyz",
    "userId": "abc123firebaseUid",
    "serviceId": "srv_ac_repair_01",
    "serviceSnapShot": {
      "serviceName": "AC General Service",
      "visitCharge": 99,
      "pricingModel": "fixed",
      "unitPrice": 499
    },
    "addedCouponSnapShot": {
      "code": "SAVE50",
      "description": "₹50 flat off on all bookings",
      "minimumOrderValue": 300,
      "discountType": "flat",
      "discountValue": 50,
      "estimatedDiscount": 50
    },
    "quantity": 1,
    "estimatedPrice": 449,
    "status": "pending",
    "paymentStatus": "pending"
  }
}
```

---

#### `GET /api/bookings`
Retrieves all bookings made by the authenticated customer.

- **Access**: Authenticated (`customer`)
- **Headers**: `Authorization: Bearer <ID_TOKEN>`
- **Response (200 OK)**:
```json
{
  "count": 1,
  "bookings": [ { ... } ]
}
```

---

#### `GET /api/bookings/:bookingId`
Retrieves a specific booking by ID. Customers can only access their own bookings; Admins can access any booking.

- **Access**: Authenticated (`customer`, `admin`)
- **Headers**: `Authorization: Bearer <ID_TOKEN>`
- **Response (200 OK)**:
```json
{
  "booking": {
    "bookingId": "bk_789xyz",
    "status": "pending",
    ...
  }
}
```

---

#### `GET /api/bookings/admin/all`
Retrieves all bookings across the entire platform. Supports filtering by status (`?status=pending`).

- **Access**: Admin Only (`role: "admin"`)
- **Headers**: `Authorization: Bearer <ADMIN_ID_TOKEN>`
- **Query Params**: `?status=pending|completed|cancelled` (optional)
- **Response (200 OK)**:
```json
{
  "count": 25,
  "bookings": [ ... ]
}
```

---

#### `PATCH /api/bookings/:bookingId/confirm`
Confirms a pending booking. Only technicians or administrators can confirm a booking. Once confirmed, customers cannot cancel the booking themselves.

- **Access**: Admin or Provider (`role: "admin"` or `role: "provider"`)
- **Headers**: `Authorization: Bearer <TOKEN>`
- **Response (200 OK)**:
```json
{
  "bookingId": "bk_789xyz",
  "status": "confirmed",
  "message": "Booking confirmed successfully"
}
```

---

#### `POST /api/bookings/:bookingId/additional-charges`
Dedicated endpoint to add or update additional charges (spare parts, extra labor/materials) on-site before completing the booking. Callable only by technicians or administrators.

- **Access**: Admin or Provider (`role: "admin"` or `role: "provider"`)
- **Headers**: `Authorization: Bearer <TOKEN>`
- **Request Body**:
```json
{
  "additionalCharges": [
    { "name": "Capacitor replacement", "price": 350 },
    { "name": "Gas top-up", "price": 600 }
  ]
}
```
- **Response (200 OK)**:
```json
{
  "bookingId": "bk_789xyz",
  "additionalCharges": [
    { "name": "Capacitor replacement", "price": 350 },
    { "name": "Gas top-up", "price": 600 }
  ],
  "additionalChargesTotal": 950,
  "message": "Additional charges updated successfully"
}
```

---

#### `POST /api/bookings/:bookingId/complete`
Marks a booking as completed, calculates the final bill using the already stored additional charges, and redeems the coupon inside a Firestore transaction. All payments are collected after service completion.

- **Access**: Admin or Provider (`role: "admin"` or `role: "provider"`)
- **Headers**: `Authorization: Bearer <TOKEN>`
- **Request Body** *(optional)*:
```json
{
  "quantity": 2
}
```
*(Note: Body is optional. `quantity` applies ONLY to Fixed-Price services if the serviced units changed from the initial booking. For Visit-Estimate services, or if quantity is unchanged, simply send an empty body `{}`). `paymentStatus` is automatically set to `"paid"` in the database.*



- **Response (200 OK) - Fixed Price Service**:
```json
{
  "message": "Booking completed successfully",
  "result": {
    "bookingId": "bk_789xyz",
    "status": "completed",
    "paymentStatus": "paid",
    "finalBill": {
      "pricingModel": "fixed",
      "quantity": 1,
      "unitPrice": 499,
      "itemTotal": 499,
      "additionalCharges": [
        { "name": "Capacitor replacement", "price": 350 },
        { "name": "Gas top-up", "price": 600 }
      ],
      "additionalChargesTotal": 950,
      "subTotal": 1449,
      "discount": 50,
      "isCouponApplied": true,
      "total": 1399
    }
  }
}
```

- **Response (200 OK) - Visit Estimate Service (Repair Done, Visit Fee Waived)**:
```json
{
  "message": "Booking completed successfully",
  "result": {
    "bookingId": "bk_789xyz",
    "status": "completed",
    "paymentStatus": "paid",
    "finalBill": {
      "pricingModel": "visit_estimate",
      "serviceOutcome": "repair_completed",
      "visitCharge": 99,
      "visitChargeWaived": true,
      "repairChargesTotal": 950,
      "subTotal": 950,
      "discount": 50,
      "total": 900
    }
  }
}
```

- **Response (200 OK) - Visit Estimate Service (Customer Declined Repair, Billed Inspection Fee Only)**:
```json
{
  "message": "Booking completed successfully",
  "result": {
    "bookingId": "bk_789xyz",
    "status": "completed",
    "paymentStatus": "paid",
    "finalBill": {
      "pricingModel": "visit_estimate",
      "serviceOutcome": "inspection_only",
      "visitCharge": 99,
      "visitChargeWaived": false,
      "visitChargeApplied": 99,
      "repairChargesTotal": 0,
      "subTotal": 99,
      "discount": 0,
      "total": 99
    }
  }
}
```

---

#### `POST /api/bookings/:bookingId/cancel`
Cancels a booking and atomically releases any reserved coupon so the user can use it again.
- **Rules**:
  1. Customers can cancel **only if the booking is `pending`**. If it is `confirmed`, customers **cannot cancel** (`403 Forbidden`).
  2. Only technicians (`provider`) or `admin` can cancel a `confirmed` booking.
  3. If cancelled **after confirmation**, the customer must pay the **Visit Charge** (e.g. ₹99), which applies to both Fixed-Price and Visit-Estimate services.

- **Access**: Customer (if pending), Admin or Provider (anytime)
- **Headers**: `Authorization: Bearer <ID_TOKEN>`
- **Request Body**:
```json
{
  "reason": "Customer declined service at doorstep"
}
```
- **Response (200 OK) - Cancelled While Pending (₹0 Fee)**:
```json
{
  "bookingId": "bk_789xyz",
  "status": "cancelled",
  "cancellationFee": 0,
  "paymentStatus": "pending",
  "message": "Booking cancelled successfully"
}
```
- **Response (200 OK) - Cancelled After Confirmation (Visit Charge Incurred)**:
```json
{
  "bookingId": "bk_789xyz",
  "status": "cancelled",
  "cancellationFee": 99,
  "paymentStatus": "pending",
  "message": "Booking cancelled. A visit charge of ₹99 applies because the booking was already confirmed."
}
```
- **Customer Cancellation Blocked Error (403 Forbidden)**:
```json
{
  "message": "Confirmed bookings cannot be cancelled by the customer. Please contact your technician or support."
}
```


---

### 3.3 Coupon Endpoints (`/api/coupons`)

---

#### `POST /api/coupons`
Creates a new coupon. Guarantees via Firestore transaction that **no other active and valid coupon with the same code can exist**.

- **Access**: Admin Only (`role: "admin"`)
- **Headers**: `Authorization: Bearer <ADMIN_ID_TOKEN>`
- **Request Body**:
```json
{
  "code": "SUMMER20",
  "description": "20% off up to ₹200 on AC Services",
  "discountType": "percentage",
  "discountValue": 20,
  "maxDiscount": 200,
  "criteria": {
    "minimumOrderValue": 500,
    "isFirstBookingOnly": false,
    "applicability": {
      "type": "service",
      "applicableServiceIds": ["srv_ac_repair_01", "srv_ac_installation_02"]
    }
  },
  "totalUsageLimit": 500,
  "validTill": "2026-10-31T23:59:59.000Z",
  "isActive": true
}
```
- **Response (201 Created)**:
```json
{
  "message": "Coupon created successfully",
  "coupon": {
    "couponId": "cpn_456def",
    "code": "SUMMER20",
    "discountType": "percentage",
    "discountValue": 20,
    "maxDiscount": 200,
    "isActive": true
  }
}
```
- **Conflict Error (409 Conflict)**:
```json
{
  "message": "An active and valid coupon with code 'SUMMER20' already exists (ID: cpn_123abc)"
}
```

---

#### `GET /api/coupons`
Lists all coupons.

- **Access**: Public / Authenticated
- **Query Params**: `?activeOnly=true` (optional)
- **Response (200 OK)**:
```json
{
  "count": 3,
  "coupons": [ ... ]
}
```

---

#### `GET /api/coupons/validate`
Previews and validates a coupon for a prospective booking without creating the booking yet.

- **Access**: Authenticated (`customer`)
- **Headers**: `Authorization: Bearer <ID_TOKEN>`
- **Query Params**:
  - `code=SUMMER20`
  - `serviceId=srv_ac_repair_01`
  - `categoryId=cat_hvac`
  - `orderValue=1200`
- **Response (200 OK)**:
```json
{
  "valid": true,
  "coupon": {
    "couponId": "cpn_456def",
    "couponCode": "SUMMER20",
    "discountType": "percentage",
    "discountValue": 20,
    "maxDiscount": 200,
    "minimumOrderValue": 500,
    "computedDiscount": 200
  }
}
```

---

#### `PATCH /api/coupons/:couponId/deactivate`
Deactivates a coupon. Once deactivated, the coupon code becomes eligible for recycling/re-creation if desired.

- **Access**: Admin Only (`role: "admin"`)
- **Headers**: `Authorization: Bearer <ADMIN_ID_TOKEN>`
- **Response (200 OK)**:
```json
{
  "message": "Coupon deactivated successfully",
  "couponId": "cpn_456def"
}
```

---

### 3.4 Payment Endpoints (`/api/payments`)

All services use a post-service payment model where `paymentStatus` remains `"pending"` upon service completion. Payments are resolved either online via Razorpay or offline as Cash collected by the technician.

---

#### `POST /api/payments/create-order`
Creates a Razorpay order for online checkout of a completed booking or confirmed cancellation visit fee.

- **Access**: Authenticated (`customer`, `admin`)
- **Headers**: `Authorization: Bearer <ID_TOKEN>`
- **Request Body**:
```json
{
  "bookingId": "bk_789xyz"
}
```
- **Response (200 OK)**:
```json
{
  "message": "Razorpay order created successfully",
  "bookingId": "bk_789xyz",
  "orderId": "order_EKf7smt1GhNgaF",
  "amount": 1298,
  "amountInPaise": 129800,
  "currency": "INR",
  "keyId": "rzp_test_placeholder"
}
```

---

#### `POST /api/payments/cash-collection`
Called by the technician (`provider`) or `admin` when receiving payment in cash at the doorstep. Atomically creates a payment record and marks the booking as `"paid"`.

- **Access**: Admin or Provider (`role: "admin"` or `role: "provider"`)
- **Headers**: `Authorization: Bearer <TOKEN>`
- **Request Body**:
```json
{
  "bookingId": "bk_789xyz",
  "notes": "Collected ₹1298 cash from customer at doorstep"
}
```
- **Response (200 OK)**:
```json
{
  "bookingId": "bk_789xyz",
  "paymentId": "pmt_cash_12345",
  "amount": 1298,
  "method": "cash",
  "paymentStatus": "paid",
  "message": "Cash payment recorded successfully and booking updated to paid"
}
```

---

#### `POST /api/payments/webhook`
Webhook endpoint called asynchronously by Razorpay when payment succeeds (`payment.captured` or `order.paid`). Verifies HMAC SHA256 signature and updates the `payments` and `serviceBookings` documents.

- **Access**: Public (Verified via `x-razorpay-signature` header)
- **Headers**:
  ```http
  x-razorpay-signature: <HMAC_HEX_SIGNATURE>
  Content-Type: application/json
  ```
- **Response (200 OK)**:
```json
{
  "status": "ok"
}
```

---

#### `GET /api/payments/booking/:bookingId`
Retrieves all payment transactions associated with a booking.

- **Access**: Authenticated (`customer`, `admin`, `provider`)
- **Headers**: `Authorization: Bearer <ID_TOKEN>`
- **Response (200 OK)**:
```json
{
  "count": 1,
  "payments": [
    {
      "paymentId": "pmt_cash_12345",
      "bookingId": "bk_789xyz",
      "userId": "usr_cust_12345",
      "amount": 1298,
      "currency": "INR",
      "method": "cash",
      "status": "paid",
      "collectedBy": "tech_prov_888",
      "createdAt": "2026-09-02T13:30:00.000Z"
    }
  ]
}
```

---

### 3.5 System Endpoints

#### `GET /health`
Health-check endpoint to verify server availability.

- **Access**: Public
- **Response (200 OK)**:
```json
{
  "message": "server is running"
}
```


---

## 4. Standard Error Response Format

When an error occurs, the server responds with standard HTTP status codes and a JSON error payload:

```json
{
  "message": "Descriptive error message explaining what failed"
}
```

### Common HTTP Status Codes

| Code | Status | Meaning |
| :--- | :--- | :--- |
| `400` | Bad Request | Input validation error or invalid request parameters |
| `401` | Unauthorized | Missing, invalid, or expired Bearer token |
| `403` | Forbidden | Insufficient permissions (e.g. customer attempting an admin action) |
| `404` | Not Found | Requested service, booking, user, or route does not exist |
| `409` | Conflict | Active and valid coupon code already exists |
| `429` | Too Many Requests | Rate limit exceeded (e.g. more than 2 OTP requests in 15 minutes) |
| `500` | Internal Server Error | Unexpected system error |
| `502` | Bad Gateway | External third-party provider (e.g. Message Central SMS) failed |
