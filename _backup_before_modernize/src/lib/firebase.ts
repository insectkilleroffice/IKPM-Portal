import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const requiredEnvVars = [
  { key: "apiKey", name: "VITE_FIREBASE_API_KEY" },
  { key: "authDomain", name: "VITE_FIREBASE_AUTH_DOMAIN" },
  { key: "projectId", name: "VITE_FIREBASE_PROJECT_ID" },
  { key: "appId", name: "VITE_FIREBASE_APP_ID" },
] as const;

const missingVars = requiredEnvVars
  .filter(({ key }) => !firebaseConfig[key])
  .map(({ name }) => name);

if (missingVars.length > 0) {
  console.warn(
    `[Firebase Config Warning] Missing required Firebase environment variable(s): ${missingVars.join(
      ", "
    )}. Please ensure they are defined in your .env.local file.`
  );
}

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = firebaseConfig.storageBucket ? getStorage(app) : null;

export default app;
