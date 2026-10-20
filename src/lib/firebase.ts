import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { firebaseEnv } from "../config/env";

const firebaseConfig = firebaseEnv;

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

// Offline-first cache: writes made without internet are queued by Firestore itself and
// synced when the connection returns, and reads are served from IndexedDB instantly.
const createDb = (): Firestore => {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      ignoreUndefinedProperties: true,
    });
  } catch {
    // Already initialized (Vite hot reload) — reuse the existing instance
    return getFirestore(app);
  }
};
export const db = createDb();

/**
 * A second, isolated Firebase app used only by the super admin to create staff logins.
 * createUserWithEmailAndPassword signs the new user in on whichever Auth instance it runs on,
 * so using a separate instance keeps the admin's own session intact.
 */
export const getProvisioningAuth = () => {
  const name = "ikpm-provisioning";
  const existing = getApps().find((a) => a.name === name);
  return getAuth(existing ?? initializeApp(firebaseConfig, name));
};
export const storage = firebaseConfig.storageBucket ? getStorage(app) : null;

export default app;
