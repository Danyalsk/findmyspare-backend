import { initializeApp, cert, getApps, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
// PEM keys are stored with literal \n escapes in env vars.
const PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

let app: App | null = null;

function getApp(): App | null {
  if (app) return app;
  if (getApps().length) {
    app = getApps()[0]!;
    return app;
  }
  if (!PROJECT_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
    if (process.env.NODE_ENV === "production") {
      // eslint-disable-next-line no-console
      console.warn("[firebase-admin] credentials missing — phone OTP verification disabled.");
    }
    return null;
  }
  app = initializeApp({
    credential: cert({
      projectId: PROJECT_ID,
      clientEmail: CLIENT_EMAIL,
      privateKey: PRIVATE_KEY,
    }),
  });
  return app;
}

export type VerifiedPhoneToken = {
  uid: string;
  phoneNumber: string;
};

/**
 * Verifies a Firebase ID token (issued by Firebase Phone Auth on the client)
 * and returns the verified phone number in E.164 format.
 */
export async function verifyFirebasePhoneToken(idToken: string): Promise<VerifiedPhoneToken> {
  const a = getApp();
  if (!a) throw new Error("Firebase Admin not configured");
  const decoded = await getAuth(a).verifyIdToken(idToken, true);
  if (!decoded.phone_number) {
    throw new Error("Token does not include a verified phone number");
  }
  return { uid: decoded.uid, phoneNumber: decoded.phone_number };
}
