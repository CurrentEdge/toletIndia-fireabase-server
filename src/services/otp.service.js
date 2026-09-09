import { AxiosError } from "axios";
import { otpClient } from "../clients/otp.Client.js";
import { AppError } from "../error/app.error.js";

let authToken = null;
let authTokenExpiry = 0;

/**
 * Normalizes phone numbers to standard 10-digit mobile number and country code for Message Central.
 */
export const normalizePhoneNumber = (rawNumber) => {
    if (!rawNumber) return { countryCode: "91", mobileNumber: "" };
    const cleaned = String(rawNumber).replace(/[^0-9]/g, "");

    // If 12 digits starting with 91 (India)
    if (cleaned.length === 12 && cleaned.startsWith("91")) {
        return { countryCode: "91", mobileNumber: cleaned.substring(2) };
    }
    // If standard 10 digits
    if (cleaned.length === 10) {
        return { countryCode: "91", mobileNumber: cleaned };
    }

    return { countryCode: "91", mobileNumber: cleaned };
};

const generateAuthToken = async () => {
    try {
        const key = Buffer
            .from(process.env.MESSAGE_CENTRAL_PASSWORD || "", "utf8")
            .toString("base64");

        const response = await otpClient.get(
            "/auth/v1/authentication/token",
            {
                params: {
                    customerId: process.env.MESSAGE_CENTRAL_CUSTOMER_ID,
                    key: key,
                    scope: "NEW",
                    country: "91",
                },
            }
        );

        authToken = response.data?.token || response.data?.data?.token;

        if (!authToken) {
            throw new AppError("Failed to obtain authentication token from OTP provider", 502);
        }

        // Decode JWT payload to get expiry (payload is at index 1)
        const payload = JSON.parse(
            Buffer.from(authToken.split(".")[1], "base64url").toString("utf8")
        );

        authTokenExpiry = Number(payload.exp) || 0; // Expiry in seconds
    } catch (error) {
        if (error instanceof AppError) throw error;
        console.error("Failed to generate OTP auth token:", error.response?.data || error.message);
        throw new AppError("OTP service authentication failed", 502);
    }
};

const checkTokenExpiry = () => {
    // Current time in seconds to match JWT exp
    const nowInSeconds = Math.floor(Date.now() / 1000);
    // Refresh if missing, expired, or expiring in less than 60 seconds
    return nowInSeconds >= (authTokenExpiry - 60);
};

export const sendOtpSms = async (phoneNumber) => {
    try {
        if (!authToken || checkTokenExpiry()) {
            await generateAuthToken();
        }

        const { countryCode, mobileNumber } = normalizePhoneNumber(phoneNumber);

        const response = await otpClient.post(
            "/verification/v3/send",
            null,
            {
                params: {
                    countryCode,
                    flowType: "SMS",
                    mobileNumber,
                },
                headers: {
                    authToken: authToken,
                },
            }
        );

        const responseData = response.data || {};

        if (response.status === 200 && (responseData.responseCode === 200 || responseData.status === 200)) {
            return {
                verificationId: responseData.verificationId || responseData.data?.verificationId,
                mobileNumber,
            };
        }

        console.error("Message Central send error response:", responseData);
        throw new AppError(responseData.message || "Failed to send OTP", 400);
    } catch (e) {
        if (e instanceof AppError) throw e;

        if (e instanceof AxiosError) {
            const errorMsg = e.response?.data?.message || e.message;
            console.error("Axios sendOtpSms error:", e.response?.status, errorMsg);
            throw new AppError(`OTP provider error: ${errorMsg}`, e.response?.status || 502);
        }

        console.error("Unexpected error in sendOtpSms:", e);
        throw new AppError("Internal server error while sending OTP", 500);
    }
};

export const validateOtp = async (code, verificationId) => {
    try {
        if (!authToken || checkTokenExpiry()) {
            await generateAuthToken();
        }

        const response = await otpClient.get(
            "/verification/v3/validateOtp",
            {
                params: {
                    verificationId: verificationId,
                    code: code,
                },
                headers: {
                    authToken: authToken,
                },
            }
        );

        const responseData = response.data || {};

        if (response.status === 200) {
            if (responseData.responseCode === 705 || responseData.responseCode === 702) {
                throw new AppError("Invalid or expired OTP code", 400);
            }

            if (responseData.responseCode === 200 || responseData.status === 200) {
                const mobile =
                    responseData.data?.mobileNumber ||
                    responseData.mobileNumber ||
                    responseData.data?.phone;
                return mobile;
            }
        }

        console.error("Message Central validate error response:", responseData);
        throw new AppError(responseData.message || "OTP verification failed", 400);
    } catch (e) {
        if (e instanceof AppError) throw e;

        if (e instanceof AxiosError) {
            const errorMsg = e.response?.data?.message || e.message;
            console.error("Axios validateOtp error:", e.response?.status, errorMsg);
            throw new AppError(`OTP validation error: ${errorMsg}`, e.response?.status || 400);
        }

        console.error("Unexpected error in validateOtp:", e);
        throw new AppError("Internal server error while verifying OTP", 500);
    }
};