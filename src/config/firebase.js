import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const cleanEnvVar = (val) => {
    if (!val || typeof val !== "string") return "";
    return val.trim().replace(/^["']|["']$/g, "").trim();
};

const getFirebaseCredential = () => {
    // 1. Check for full service account JSON or Base64 string
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        try {
            const raw = cleanEnvVar(process.env.FIREBASE_SERVICE_ACCOUNT);
            const jsonStr = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
            const parsed = JSON.parse(jsonStr);
            return cert(parsed);
        } catch (e) {
            console.error("[FirebaseConfig] Failed to parse FIREBASE_SERVICE_ACCOUNT:", e.message);
        }
    }

    // 2. Standard individual environment variables
    const projectId = cleanEnvVar(process.env.FIREBASE_PROJECT_ID);
    const clientEmail = cleanEnvVar(process.env.FIREBASE_CLIENT_EMAIL);
    let privateKey = cleanEnvVar(process.env.FIREBASE_PRIVATE_KEY);

    if (projectId && clientEmail && privateKey) {
        // Strip carriage returns and replace literal escaped \n with actual newlines
        privateKey = privateKey.replace(/\r/g, "").replace(/\\n/g, "\n").trim();

        if (!privateKey.includes("-----BEGIN PRIVATE KEY-----")) {
            console.error(
                "[FirebaseConfig] WARNING: FIREBASE_PRIVATE_KEY does not contain '-----BEGIN PRIVATE KEY-----'. " +
                "Please check the environment variable value in Vercel."
            );
        }

        return cert({
            projectId,
            clientEmail,
            privateKey,
        });
    }

    throw new Error(
        "Firebase credentials not found in environment variables. Please set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in .env"
    );
};

if (!getApps().length) {
    initializeApp({
        credential: getFirebaseCredential(),
    });
}

export const db = getFirestore();
export const auth = getAuth();
export const message = getMessaging();



