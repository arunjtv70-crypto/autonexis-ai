import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDABjmFi6A0XD93s9BhC5-B5mGEXdtZSFs",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "autonexis-ai.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "autonexis-ai",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "autonexis-ai.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "719867680502",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:719867680502:web:ac5553aad21a1a655f3ed7",
};

// Initialize Firebase singleton
export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
