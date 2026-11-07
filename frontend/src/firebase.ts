import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

// Public Firebase Web Client Configuration (safe for frontend)
const firebaseConfig = {
  apiKey: "AIzaSyAvl-3er0vXWecXDfTH6Bq_UFucFMfX4VI",
  authDomain: "autonexis-ai-assistant.firebaseapp.com",
  projectId: "autonexis-ai-assistant",
  storageBucket: "autonexis-ai-assistant.firebasestorage.app",
  messagingSenderId: "312176579650",
  appId: "1:312176579650:web:1ce2b8e1d7071f60c609db",
};

// Initialize Firebase singleton
export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
