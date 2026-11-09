import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";

// Public Firebase Web Client Configuration (safe for frontend)
const firebaseConfig = {
  apiKey: "AIzaSyBGQERTvAyNfP_jvOXp1EgJF9lFp-w8Sck",
  authDomain: "autonexis-ai-assistant-7a2e7.firebaseapp.com",
  projectId: "autonexis-ai-assistant-7a2e7",
  storageBucket: "autonexis-ai-assistant-7a2e7.firebasestorage.app",
  messagingSenderId: "899165689083",
  appId: "1:899165689083:web:8feee8d2ea513d8437cc5e",
};

// On app start, if stored Firebase auth belongs to a different project id,
// clean it so no stale cross-project session survives.
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

// Resilient Firebase initialization with fallback
let appInstance: FirebaseApp;
let authInstance: Auth;
let googleProviderInstance: GoogleAuthProvider;

try {
  appInstance = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  authInstance = getAuth(appInstance);
  googleProviderInstance = new GoogleAuthProvider();
  googleProviderInstance.setCustomParameters({ prompt: "select_account" });
} catch (error) {
  console.warn("[AUTONEXIS] Firebase failed to initialize gracefully:", error);
  // Safe dummy fallback so module evaluation and React rendering never fail
  appInstance = {
    name: "[DEFAULT]",
    options: firebaseConfig,
    automaticDataCollectionEnabled: false,
  } as FirebaseApp;

  authInstance = {
    app: appInstance,
    name: "auth",
    config: {},
    currentUser: null,
    onAuthStateChanged: (_cb: any) => () => {},
    onIdTokenChanged: (_cb: any) => () => {},
    signOut: async () => {},
  } as unknown as Auth;

  googleProviderInstance = new GoogleAuthProvider();
}

export const app = appInstance;
export const auth = authInstance;
export const googleProvider = googleProviderInstance;
