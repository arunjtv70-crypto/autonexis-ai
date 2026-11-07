import React, { createContext, useContext, useState } from "react";
import {
  apiRegisterEmail,
  apiLoginEmail,
  apiLoginGoogle,
  apiSendOtp,
  apiVerifyOtp,
  apiUpdateProfile,
  type UserResponse,
} from "../api/auth";

interface AuthContextType {
  user: UserResponse | null;
  token: string | null;
  isAuthenticated: boolean;
  isGuest: boolean;
  isAuthScreenVisible: boolean;
  setIsAuthScreenVisible: (visible: boolean) => void;
  isLoading: boolean;
  loginEmail: (email: string, pass: string) => Promise<{ success: boolean; error?: string }>;
  signupEmail: (name: string, email: string, pass: string) => Promise<{ success: boolean; error?: string }>;
  loginGoogle: (mockEmail?: string) => Promise<{ success: boolean; error?: string }>;
  sendOtp: (phone: string) => Promise<{ success: boolean; devOtp?: string; error?: string }>;
  verifyOtp: (phone: string, otp: string) => Promise<{ success: boolean; error?: string }>;
  loginAsGuest: () => void;
  logout: () => void;
  updateProfileName: (name: string) => Promise<void>;
}

const AUTH_TOKEN_KEY = "autonexis_auth_token";
const AUTH_USER_KEY = "autonexis_auth_user";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem(AUTH_TOKEN_KEY);
    } catch {
      return null;
    }
  });

  const [user, setUser] = useState<UserResponse | null>(() => {
    try {
      const stored = localStorage.getItem(AUTH_USER_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  // Default: if no real user token is saved, display Auth screen first
  const [isAuthScreenVisible, setIsAuthScreenVisible] = useState<boolean>(() => {
    const existing = localStorage.getItem(AUTH_TOKEN_KEY);
    return !existing || existing === "mock_jwt_guest";
  });

  const [isGuest, setIsGuest] = useState<boolean>(() => {
    const existing = localStorage.getItem(AUTH_TOKEN_KEY);
    return existing === "mock_jwt_guest";
  });

  const [isLoading, setIsLoading] = useState<boolean>(false);

  const saveSession = (newToken: string, newUser: UserResponse, asGuest: boolean = false) => {
    setToken(newToken);
    setUser(newUser);
    setIsGuest(asGuest);
    setIsAuthScreenVisible(false);
    try {
      localStorage.setItem(AUTH_TOKEN_KEY, newToken);
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(newUser));
    } catch {
      // Storage error
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    setIsGuest(false);
    setIsAuthScreenVisible(true);
    try {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      localStorage.removeItem(AUTH_USER_KEY);
    } catch {
      // Storage error
    }
  };

  // 1. Real Email Registration via FastAPI Backend
  const signupEmail = async (name: string, email: string, pass: string) => {
    setIsLoading(true);
    try {
      const res = await apiRegisterEmail(email, pass, name);
      if (!res.success) {
        return { success: false, error: res.error };
      }
      saveSession(res.token, res.user, false);
      return { success: true };
    } finally {
      setIsLoading(false);
    }
  };

  // 2. Real Email Login via FastAPI Backend
  const loginEmail = async (email: string, pass: string) => {
    setIsLoading(true);
    try {
      const res = await apiLoginEmail(email, pass);
      if (!res.success) {
        return { success: false, error: res.error };
      }
      saveSession(res.token, res.user, false);
      return { success: true };
    } finally {
      setIsLoading(false);
    }
  };

  // 3. Real Google Login
  const loginGoogle = async (mockEmail?: string) => {
    setIsLoading(true);
    try {
      const res = await apiLoginGoogle(mockEmail);
      if (!res.success) {
        return { success: false, error: res.error };
      }
      saveSession(res.token, res.user, false);
      return { success: true };
    } finally {
      setIsLoading(false);
    }
  };

  // 4. Real Phone OTP Send via FastAPI Backend
  const sendOtp = async (phone: string) => {
    setIsLoading(true);
    try {
      const res = await apiSendOtp(phone);
      if (!res.success) {
        return { success: false, error: res.error };
      }
      return { success: true, devOtp: res.devOtp };
    } finally {
      setIsLoading(false);
    }
  };

  // 5. Real Phone OTP Verify via FastAPI Backend
  const verifyOtp = async (phone: string, otp: string) => {
    setIsLoading(true);
    try {
      const res = await apiVerifyOtp(phone, otp);
      if (!res.success) {
        return { success: false, error: res.error };
      }
      saveSession(res.token, res.user, false);
      return { success: true };
    } finally {
      setIsLoading(false);
    }
  };

  // 6. Guest Mode
  const loginAsGuest = () => {
    const guestUser: UserResponse = {
      id: "usr_guest",
      display_name: "Guest",
      theme_preference: "auto",
    };
    saveSession("mock_jwt_guest", guestUser, true);
  };

  // 7. Real Profile Update
  const updateProfileName = async (name: string) => {
    if (!user) return;
    const updated = { ...user, display_name: name };
    setUser(updated);
    try {
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(updated));
      if (token && token !== "mock_jwt_guest") {
        await apiUpdateProfile(token, name);
      }
    } catch {
      // Ignore
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!token && !isGuest,
        isGuest,
        isAuthScreenVisible,
        setIsAuthScreenVisible,
        isLoading,
        loginEmail,
        signupEmail,
        loginGoogle,
        sendOtp,
        verifyOtp,
        loginAsGuest,
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
