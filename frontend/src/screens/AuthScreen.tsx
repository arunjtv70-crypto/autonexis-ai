import React, { useState, useEffect } from "react";
import { useAuth } from "../state/auth";
import { Logo } from "../components/Logo";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { OtpInput } from "../components/OtpInput";
import { IconGoogle } from "../components/Icons";
import "./AuthScreen.css";

type AuthTab = "email" | "phone";

export const AuthScreen: React.FC = () => {
  const { loginEmail, signupEmail, loginGoogle, sendOtp, verifyOtp, loginAsGuest, isLoading } = useAuth();

  const [activeTab, setActiveTab] = useState<AuthTab>("email");
  const [isSignUp, setIsSignUp] = useState<boolean>(false);

  // Email form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Phone OTP state
  const [phone, setPhone] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [resendTimer, setResendTimer] = useState(0);

  // Feedback messages
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // Countdown timer for OTP resend
  useEffect(() => {
    let interval: any = null;
    if (resendTimer > 0) {
      interval = setInterval(() => {
        setResendTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [resendTimer]);

  const clearMessages = () => {
    setErrorMsg(null);
    setInfoMsg(null);
  };

  // Handle Email submission
  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();

    if (!email || !password) {
      setErrorMsg("Please fill in all required fields.");
      return;
    }

    if (isSignUp) {
      const res = await signupEmail(name, email, password);
      if (!res.success) setErrorMsg(res.error || "Sign up failed. Please try again.");
    } else {
      const res = await loginEmail(email, password);
      if (!res.success) setErrorMsg(res.error || "Invalid email or password.");
    }
  };

  // Handle Google Login
  const handleGoogleLogin = async () => {
    clearMessages();
    const res = await loginGoogle();
    if (!res.success) setErrorMsg(res.error || "Google sign-in was canceled.");
  };

  // Handle Phone OTP Request
  const handleSendOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    clearMessages();

    const digitsOnly = phone.replace(/[^0-9]/g, "");
    if (digitsOnly.length < 10) {
      setErrorMsg("Please enter a valid 10-digit mobile number.");
      return;
    }

    const res = await sendOtp(phone);
    if (res.success) {
      setOtpSent(true);
      setResendTimer(30);
      setInfoMsg(`A 6-digit verification code has been sent. (Test Code: ${res.devOtp || "811011"})`);
    } else {
      setErrorMsg(res.error || "Failed to dispatch verification code.");
    }
  };

  // Handle OTP Verification
  const handleVerifyOtp = async (otpToVerify: string) => {
    clearMessages();
    const res = await verifyOtp(phone, otpToVerify);
    if (!res.success) {
      setErrorMsg(res.error || "Invalid verification code. Please try again.");
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
            Mobile OTP
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

        {/* TAB 2: MOBILE NUMBER & OTP */}
        {activeTab === "phone" && (
          <div className="auth-form">
            {!otpSent ? (
              <form onSubmit={handleSendOtp} className="phone-step-form">
                <div className="phone-input-group">
                  <div className="country-code-pill">+91 (India)</div>
                  <Input
                    type="tel"
                    placeholder="98765 43210"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={isLoading}
                    autoFocus
                  />
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  fullWidth
                  isLoading={isLoading}
                >
                  Send OTP
                </Button>
              </form>
            ) : (
              <div className="otp-step-wrap">
                <div className="otp-info">
                  <p>Code sent to <strong>+91 {phone}</strong></p>
                  <button
                    type="button"
                    className="edit-phone-btn"
                    onClick={() => { setOtpSent(false); setOtp(""); clearMessages(); }}
                  >
                    Change number
                  </button>
                </div>

                <OtpInput
                  value={otp}
                  onChange={(val) => { setOtp(val); clearMessages(); }}
                  onComplete={handleVerifyOtp}
                  disabled={isLoading}
                />

                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  fullWidth
                  disabled={otp.length !== 6 || isLoading}
                  isLoading={isLoading}
                  onClick={() => handleVerifyOtp(otp)}
                >
                  Verify & Continue
                </Button>

                <div className="resend-row">
                  {resendTimer > 0 ? (
                    <span className="resend-timer-text">
                      Resend code in {resendTimer}s
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="resend-btn"
                      onClick={() => handleSendOtp()}
                      disabled={isLoading}
                    >
                      Resend OTP
                    </button>
                  )}
                </div>
              </div>
            )}
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

        {/* Guest Preview */}
        <div className="guest-action-wrap">
          <button
            type="button"
            className="guest-preview-btn"
            onClick={loginAsGuest}
          >
            Explore as Guest →
          </button>
        </div>

        {/* Footer */}
        <footer className="auth-footer-note">
          <span>AUTONEXIS Assistant • Private and Thoughtful AI</span>
        </footer>
      </div>
    </div>
  );
};
