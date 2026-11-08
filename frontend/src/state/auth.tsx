import React, { createContext, useContext, useState, useEffect } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
  type User as FirebaseUser,
} from "firebase/auth";
import { auth, googleProvider } from "../firebase";
import { apiUpdateProfile, type UserResponse } from "../api/auth";

export function formatFirebaseAuthError(error: any): string {
  const code = error?.code || "";
  switch (code) {
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password. Please try again.";
    case "auth/email-already-in-use":
      return "An account with this email already exists. Please log in instead.";
    case "auth/weak-password":
      return "Password should be at least 6 characters long.";
    case "auth/popup-closed-by-user":
      return "Sign-in was cancelled before completion.";
    case "auth/popup-blocked":
      return "Sign-in popup was blocked by your browser. Redirecting instead...";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a few moments and try again.";
    case "auth/network-request-failed":
      return "Network connection issue. Please check your internet and try again.";
    case "auth/user-disabled":
      return "This account has been disabled. Please contact support.";
    case "auth/operation-not-allowed":
      return "Authentication provider is not enabled in your project settings.";
    default:
      if (typeof error?.message === "string" && !error.message.includes("Firebase:")) {
        return error.message;
      }
      return "An authentication error occurred. Please try again.";
  }
}

interface AuthContextType {
  user: UserResponse | null;
  firebaseUser: FirebaseUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isGuest: boolean;
  isAuthScreenVisible: boolean;
  setIsAuthScreenVisible: (visible: boolean) => void;
  continueAsGuest: () => void;
  exitGuestMode: () => void;
  isLoading: boolean;
  loginEmail: (email: string, pass: string) => Promise<{ success: boolean; error?: string; errorCode?: string }>;
  signupEmail: (name: string, email: string, pass: string) => Promise<{ success: boolean; error?: string; errorCode?: string; message?: string }>;
  loginGoogle: () => Promise<{ success: boolean; error?: string; errorCode?: string }>;
  sendPasswordReset: (email: string) => Promise<{ success: boolean; error?: string; errorCode?: string; message?: string }>;
  logout: () => Promise<void>;
  updateProfileName: (name: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [user, setUser] = useState<UserResponse | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isAuthScreenVisible, setIsAuthScreenVisible] = useState<boolean>(false);
  const [isGuest, setIsGuest] = useState<boolean>(() => {
    return localStorage.getItem("autonexis_is_guest") === "true";
  });

  // Helper to notify other tabs/components about auth state changes
  const broadcastAuthEvent = (type: "LOGOUT" | "AUTH_CHANGED", uid?: string | null) => {
    try {
      if (typeof BroadcastChannel !== "undefined") {
        const bc = new BroadcastChannel("autonexis_auth_sync");
        bc.postMessage({ type, uid });
        bc.close();
      }
      localStorage.setItem("autonexis_auth_sync_event", JSON.stringify({ type, uid, t: Date.now() }));
    } catch {}
  };

  // Sync Firebase User to UserResponse format
  const syncUser = async (fbUser: FirebaseUser | null) => {
    if (!fbUser) {
      setFirebaseUser(null);
      setUser(null);
      setToken(null);
      if (localStorage.getItem("autonexis_is_guest") === "true") {
        setIsGuest(true);
        setIsAuthScreenVisible(false);
        broadcastAuthEvent("AUTH_CHANGED", "guest");
      } else {
        setIsGuest(false);
        setIsAuthScreenVisible(true);
        broadcastAuthEvent("LOGOUT", null);
      }
      return;
    }

    try {
      const idToken = await fbUser.getIdToken();
      const rawName = fbUser.displayName;
      const email = fbUser.email || "";
      const derivedName = rawName || (email ? email.split("@")[0].replace(/[._-]+/g, " ").trim() : "User");
      const cleanName = derivedName ? derivedName.charAt(0).toUpperCase() + derivedName.slice(1) : "User";

      const mapped: UserResponse = {
        id: fbUser.uid,
        email: fbUser.email,
        phone: fbUser.phoneNumber,
        display_name: cleanName,
        theme_preference: "auto",
      };

      setFirebaseUser(fbUser);
      setUser(mapped);
      setToken(idToken);
      setIsGuest(false);
      localStorage.removeItem("autonexis_is_guest");
      setIsAuthScreenVisible(false);
      broadcastAuthEvent("AUTH_CHANGED", fbUser.uid);
    } catch (err) {
      console.error("[AUTONEXIS] Failed to extract token:", err);
      setUser(null);
      setToken(null);
      setIsAuthScreenVisible(true);
      broadcastAuthEvent("LOGOUT", null);
    }
  };

  const continueAsGuest = () => {
    setIsGuest(true);
    localStorage.setItem("autonexis_is_guest", "true");
    setIsAuthScreenVisible(false);
    broadcastAuthEvent("AUTH_CHANGED", "guest");
  };

  const exitGuestMode = () => {
    setIsGuest(false);
    localStorage.removeItem("autonexis_is_guest");
    setIsAuthScreenVisible(true);
    broadcastAuthEvent("LOGOUT", null);
  };

  // 1. Listen to real Firebase Auth State
  useEffect(() => {
    setIsLoading(true);

    // Check redirect result for mobile devices
    getRedirectResult(auth)
      .then((result) => {
        if (result?.user) {
          syncUser(result.user);
        }
      })
      .catch((err) => {
        console.warn("[AUTONEXIS] Redirect auth note:", err);
      });

    const unsubscribe = onAuthStateChanged(auth, async (current) => {
      await syncUser(current);
      setIsLoading(false);
    });

    // Handle global 401 unauthorized event
    const handleUnauthorizedEvent = () => {
      signOut(auth).catch(() => {});
      setUser(null);
      setToken(null);
      setIsAuthScreenVisible(true);
    };
    window.addEventListener("autonexis:unauthorized", handleUnauthorizedEvent);

    return () => {
      unsubscribe();
      window.removeEventListener("autonexis:unauthorized", handleUnauthorizedEvent);
    };
  }, []);

  // 2. Email + Password Signup with Verification Email
  const signupEmail = async (name: string, email: string, pass: string) => {
    setIsLoading(true);
    try {
      const cleanEmail = email.trim();
      const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, pass);
      
      if (name.trim()) {
        try {
          await updateProfile(userCredential.user, { displayName: name.trim() });
        } catch {
          // Non-blocking
        }
      }

      // Send verification email
      try {
        await sendEmailVerification(userCredential.user);
      } catch (err) {
        console.warn("[AUTONEXIS] Verification email note:", err);
      }

      await syncUser(userCredential.user);
      return {
        success: true,
        message: "Account created successfully. A verification link has been sent to your email. Please check your inbox.",
      };
    } catch (err: any) {
      console.error("[AUTONEXIS Auth Error - Signup]", err);
      return {
        success: false,
        error: formatFirebaseAuthError(err),
        errorCode: err?.code || "auth/unknown",
      };
    } finally {
      setIsLoading(false);
    }
  };

  // 3. Email + Password Login
  const loginEmail = async (email: string, pass: string) => {
    setIsLoading(true);
    try {
      const cleanEmail = email.trim();
      const userCredential = await signInWithEmailAndPassword(auth, cleanEmail, pass);
      await syncUser(userCredential.user);
      return { success: true };
    } catch (err: any) {
      console.error("[AUTONEXIS Auth Error - Email Login]", err);
      return {
        success: false,
        error: formatFirebaseAuthError(err),
        errorCode: err?.code || "auth/unknown",
      };
    } finally {
      setIsLoading(false);
    }
  };

  // 4. Google Login with Popup and Redirect Fallback
  const loginGoogle = async () => {
    setIsLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      await syncUser(result.user);
      return { success: true };
    } catch (err: any) {
      console.error("[AUTONEXIS Auth Error - Google Login]", err);
      if (err?.code === "auth/popup-blocked") {
        try {
          await signInWithRedirect(auth, googleProvider);
          return { success: true };
        } catch (redirectErr: any) {
          console.error("[AUTONEXIS Auth Error - Google Redirect]", redirectErr);
          return {
            success: false,
            error: formatFirebaseAuthError(redirectErr),
            errorCode: redirectErr?.code || "auth/popup-blocked",
          };
        }
      }
      return {
        success: false,
        error: formatFirebaseAuthError(err),
        errorCode: err?.code || "auth/unknown",
      };
    } finally {
      setIsLoading(false);
    }
  };

  // 5. Password Reset Email
  const sendPasswordReset = async (email: string) => {
    if (!email || !email.trim()) {
      return { success: false, error: "Please enter your email address first." };
    }
    setIsLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      return {
        success: true,
        message: "Password reset instructions have been sent to your email.",
      };
    } catch (err: any) {
      console.error("[AUTONEXIS Auth Error - Password Reset]", err);
      return {
        success: false,
        error: formatFirebaseAuthError(err),
        errorCode: err?.code || "auth/unknown",
      };
    } finally {
      setIsLoading(false);
    }
  };

  // 6. Sign Out
  const logout = async () => {
    setIsLoading(true);

    // Notify other tabs immediately
    broadcastAuthEvent("LOGOUT", null);

    // Notify Service Worker to purge user cache entries
    try {
      if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: "PURGE_USER_CACHE" });
      }
    } catch {}

    // Delete Cache Storage entries
    try {
      if ("caches" in window) {
        caches.keys().then((keys) => {
          keys.forEach((key) => caches.delete(key));
        }).catch(() => {});
      }
    } catch {}

    try {
      await signOut(auth);
    } catch (err) {
      console.error("[AUTONEXIS] Logout error:", err);
    } finally {
      setUser(null);
      setFirebaseUser(null);
      setToken(null);
      setIsGuest(false);
      localStorage.removeItem("autonexis_is_guest");
      setIsAuthScreenVisible(true);
      setIsLoading(false);
    }
  };

  // 7. Update Profile Name
  const updateProfileName = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    if (auth.currentUser) {
      try {
        await updateProfile(auth.currentUser, { displayName: trimmed });
      } catch (err) {
        console.warn("[AUTONEXIS] Profile name update note:", err);
      }
    }

    if (user) {
      setUser({ ...user, display_name: trimmed });
    }

    try {
      await apiUpdateProfile(trimmed);
    } catch {
      // Best-effort backend sync
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        firebaseUser,
        token,
        isAuthenticated: !!user,
        isGuest,
        continueAsGuest,
        exitGuestMode,
        isAuthScreenVisible,
        setIsAuthScreenVisible,
        isLoading,
        loginEmail,
        signupEmail,
        loginGoogle,
        sendPasswordReset,
        logout,
        updateProfileName,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
