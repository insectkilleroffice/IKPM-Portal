// Typed, centralized access to Vite environment variables.
// Only VITE_* values are exposed to the browser — never put API secrets here.

const env = import.meta.env;

export const firebaseEnv = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const cloudinaryEnv = {
  cloudName: (env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined) || '',
  // Unsigned upload preset (Cloudinary Console > Settings > Upload > Upload presets)
  uploadPreset: (env.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined) || '',
  folder: (env.VITE_CLOUDINARY_FOLDER as string | undefined) || 'ikpm-portal',
};

export const outreachEnv = {
  // Base URL of the serverless outreach API (e.g. "/api" on Vercel). Empty = link-based fallback only.
  apiBaseUrl: (env.VITE_OUTREACH_API_URL as string | undefined) || '',
  // Sender identity shown in message templates
  companyName: (env.VITE_COMPANY_NAME as string | undefined) || 'Insect Killer Pest Management (IKPM)',
  companyPhone: (env.VITE_COMPANY_PHONE as string | undefined) || '+92 300 0000000',
  companyEmail: (env.VITE_COMPANY_EMAIL as string | undefined) || 'info@insectkiller.pk',
  companyWebsite: (env.VITE_COMPANY_WEBSITE as string | undefined) || 'www.insectkiller.pk',
};

export const integrations = {
  cloudinary: Boolean(cloudinaryEnv.cloudName && cloudinaryEnv.uploadPreset),
  outreachApi: Boolean(outreachEnv.apiBaseUrl),
};
