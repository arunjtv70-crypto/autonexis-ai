import React, { useState } from "react";
import { useAuth } from "../state/auth";
import { Logo } from "../components/Logo";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { IconGoogle } from "../components/Icons";
import "./AuthScreen.css";

type AuthTab = "email" | "phone";

export const AuthScreen: React.FC = () => {
  const { loginEmail, signupEmail, loginGoogle, sendPasswordReset, isLoading } = useAuth();

  const [activeTab, setActiveTab] = useState<AuthTab>("email");
  const [isSignUp, setIsSignUp] = useState<boolean>(false);

  // Email form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Feedback messages
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const clearMessages = () => {
    setErrorMsg(null);
    setInfoMsg(null);
  };

  // Handle Email submission (Signup or Login)
  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();

    if (!email || !password) {
      setErrorMsg("Please enter both email and password.");
      return;
    }

    if (isSignUp) {
      const res = await signupEmail(name, email, password);
      if (!res.success) {
        setErrorMsg(res.error || "Sign up failed. Please try again.");
      } else if (res.message) {
        setInfoMsg(res.message);
      }
    } else {
      const res = await loginEmail(email, password);
      if (!res.success) {
        setErrorMsg(res.error || "Invalid email or password.");
      }
    }
  };

  // Handle Forgot Password
  const handleForgotPassword = async () => {
    clearMessages();
    if (!email || !email.trim()) {
      setErrorMsg("Please enter your email address in the field above to reset your password.");
      return;
    }
    const res = await sendPasswordReset(email);
    if (!res.success) {
      setErrorMsg(res.error || "Failed to send reset email.");
    } else {
      setInfoMsg(res.message || "Password reset instructions have been sent to your email.");
    }
  };

  // Handle Google Login
  const handleGoogleLogin = async () => {
    clearMessages();
    const res = await loginGoogle();
    if (!res.success) {
      setErrorMsg(res.error || "Google sign-in was canceled.");
    }
  };

  return (
    <div className="auth-screen">
      {/* Background Watermark */}
      <div className="auth-watermark" aria-hidden="true">
        AUTONEXIS
      </div>

      <div className="auth-card">
        {/* Brand Header */}
        <div className="auth-header">
          <Logo size="lg" showSubtitle={true} />
          <p className="auth-subtext">
            Thoughtful, quiet and intelligent AI assistant
          </p>
        </div>

        {/* Auth Method Selector */}
        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            className={`auth-tab ${activeTab === "email" ? "active" : ""}`}
            onClick={() => { setActiveTab("email"); clearMessages(); }}
            role="tab"
            aria-selected={activeTab === "email"}
          >
            Email
          </button>
          <button
            type="button"
            className={`auth-tab ${activeTab === "phone" ? "active" : ""}`}
            onClick={() => { setActiveTab("phone"); clearMessages(); }}
            role="tab"
            aria-selected={activeTab === "phone"}
          >
            Mobile OTP <span className="auth-coming-soon-badge">Soon</span>
          </button>
        </div>

        {/* Alerts */}
        {errorMsg && (
          <div className="auth-alert alert-error" role="alert">
            {errorMsg}
          </div>
        )}
        {infoMsg && (
          <div className="auth-alert alert-info" role="status">
            {infoMsg}
          </div>
        )}

        {/* TAB 1: EMAIL & PASSWORD */}
        {activeTab === "email" && (
          <form onSubmit={handleEmailSubmit} className="auth-form">
            {isSignUp && (
              <Input
                label="Your Name"
                type="text"
                placeholder="e.g. Alex"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isLoading}
              />
            )}

            <Input
              label="Email Address"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
              required
            />

            <Input
              label="Password"
              isPassword={true}
              placeholder="At least 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              required
            />

            {!isSignUp && (
              <div className="auth-row-between">
                <button
                  type="button"
                  className="forgot-password-link"
                  onClick={handleForgotPassword}
                  disabled={isLoading}
                >
                  Forgot password?
                </button>
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              isLoading={isLoading}
            >
              {isSignUp ? "Sign Up" : "Log In"}
            </Button>

            <div className="auth-switch-prompt">
              <span>
                {isSignUp ? "Already have an account?" : "Don't have an account?"}
              </span>
              <button
                type="button"
                className="switch-btn"
                onClick={() => { setIsSignUp(!isSignUp); clearMessages(); }}
              >
                {isSignUp ? "Log In" : "Sign Up"}
              </button>
            </div>
          </form>
        )}

        {/* TAB 2: MOBILE NUMBER & OTP (Coming Soon) */}
        {activeTab === "phone" && (
          <div className="auth-coming-soon-card">
            <p className="coming-soon-title">Mobile OTP is coming soon</p>
            <p className="coming-soon-desc">
              Direct phone number verification will be available soon. Please continue with your Email or Google account in the meantime.
            </p>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => { setActiveTab("email"); clearMessages(); }}
            >
              Continue with Email
            </Button>
          </div>
        )}

        {/* Divider */}
        <div className="auth-divider">
          <span>or</span>
        </div>

        {/* Google Login Option */}
        <Button
          type="button"
          variant="outline"
          size="lg"
          fullWidth
          onClick={handleGoogleLogin}
          isLoading={isLoading}
          className="google-auth-btn"
        >
          <IconGoogle size={18} />
          <span>Continue with Google</span>
        </Button>

        {/* Footer */}
        <footer className="auth-footer-note">
          <span>AUTONEXIS Assistant • Private and Thoughtful AI</span>
        </footer>
      </div>
    </div>
  );
};
