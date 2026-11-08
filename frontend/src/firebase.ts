import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

// Public Firebase Web Client Configuration (safe for frontend)
const firebaseConfig = {
  apiKey: "AIzaSyBGQERTvAyNfP_jvOXp1EgJF9lFp-w8Sck",
  authDomain: "autonexis-ai-assistant-7a2e7.firebaseapp.com",
  projectId: "autonexis-ai-assistant-7a2e7",
  storageBucket: "autonexis-ai-assistant-7a2e7.firebasestorage.app",
  messagingSenderId: "899165689083",
  appId: "1:899165689083:web:8feee8d2ea513d8437cc5e",
};

// On app start, if the stored Firebase auth data belongs to a different project id,
// clear it so no stale session survives.
const ACTIVE_PROJECT_ID = "autonexis-ai-assistant-7a2e7";
if (typeof window !== "undefined") {
  try {
    const storedProject = localStorage.getItem("autonexis_active_project_id");
    if (storedProject && storedProject !== ACTIVE_PROJECT_ID) {
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith("firebase:") || key.startsWith("firebaseLocalStorage")) {
          localStorage.removeItem(key);
        }
      });
      if (window.indexedDB && window.indexedDB.deleteDatabase) {
        window.indexedDB.deleteDatabase("firebaseLocalStorageDb");
      }
    }
    localStorage.setItem("autonexis_active_project_id", ACTIVE_PROJECT_ID);
  } catch {
    // Non-blocking
  }
}

// Initialize Firebase singleton
export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
