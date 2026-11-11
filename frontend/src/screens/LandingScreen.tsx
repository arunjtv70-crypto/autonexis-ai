import React, { Suspense, useRef } from "react";
import { AuthScreen } from "./AuthScreen";
import { Logo } from "../components/Logo";
import { PwaInstallModal } from "../components/PwaInstallModal";
import { APP_TAGLINE, APP_VERSION } from "../config";
import { useTheme } from "../state/theme";
import { useAppNavigation } from "../state/navigation";
import "./LandingScreen.css";

/*
 * Headline options considered for LandingScreen:
 * 1. "One calm space to think, create, and talk."   <-- selected
 * 2. "Quiet intelligence for everyday work and ideas."
 * 3. "Your private workspace for answers, voice, and images."
 */
const HERO_HEADLINE = "One calm space to think, create, and talk.";

const LandingBelowFold = React.lazy(() => import("./LandingBelowFold"));

export const LandingScreen: React.FC = () => {
  const { resolvedTheme, setTheme } = useTheme();
  const { navigateTo } = useAppNavigation();
  const authColumnRef = useRef<HTMLDivElement | null>(null);

  const handleFocusAuth = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    const firstInput = authColumnRef.current?.querySelector("input");
    if (firstInput instanceof HTMLInputElement) {
      window.setTimeout(() => firstInput.focus(), 250);
    }
  };

  const toggleTheme = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  const handleNavRoute = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    e.preventDefault();
    navigateTo(path);
  };

  return (
    <div className="landing-page" data-landing-theme={resolvedTheme}>
      {/* Sticky Minimal Top Navigation */}
      <header className="landing-header">
        <div className="landing-header-inner">
          <a
            href="/"
            className="landing-brand-link"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            aria-label="AUTONEXIS Assistant Home"
          >
            <Logo variant="full" size="sm" layout="inline" tile="none" showSubtitle={false} />
          </a>

          <nav className="landing-top-nav" aria-label="Landing navigation">
            <a href="#features" className="landing-top-link">
              Features
            </a>
            <a href="#get-the-app" className="landing-top-link" data-browser-only="true">
              Get the app
            </a>
            <a href="#faq" className="landing-top-link">
              FAQ
            </a>
            <a
              href="/about"
              className="landing-top-link landing-top-link-muted"
              onClick={(e) => handleNavRoute(e, "/about")}
            >
              About
            </a>
          </nav>

          <div className="landing-header-actions">
            <button
              type="button"
              className="landing-theme-toggle"
              onClick={toggleTheme}
              aria-label={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} theme`}
              title={`Theme: ${resolvedTheme === "dark" ? "Dark" : "Light"}`}
            >
              {resolvedTheme === "dark" ? "Light" : "Dark"}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="landing-main">
        {/* Hero Section: Desktop 2 Columns (Left: Copy + Auth, Right: Calm Orbit Visual) */}
        <section className="landing-hero" aria-labelledby="landing-hero-title">
          <div className="landing-hero-grid">
            {/* Left Column */}
            <div className="landing-hero-left" ref={authColumnRef}>
              <div className="landing-hero-copy">
                <p className="landing-eyebrow">{APP_TAGLINE}</p>
                <h1 id="landing-hero-title" className="landing-hero-headline">
                  {HERO_HEADLINE}
                </h1>
                <p className="landing-hero-sub">
                  Private conversations, natural voice calls, image creation, and document help — organized in one distraction-free assistant.
                </p>
              </div>

              {/* Wraps existing AuthScreen component untouched */}
              <div className="landing-auth-container">
                <AuthScreen embedded={true} />
              </div>
            </div>

            {/* Right Column: Quiet CSS/SVG Orbit Ring Visual */}
            <div className="landing-hero-right" aria-hidden="true">
              <div className="landing-orbit-stage">
                <svg
                  className="landing-orbit-svg"
                  viewBox="0 0 360 360"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <circle
                    cx="180"
                    cy="180"
                    r="150"
                    className="orbit-ring orbit-ring-outer"
                  />
                  <circle
                    cx="180"
                    cy="180"
                    r="112"
                    className="orbit-ring orbit-ring-mid"
                  />
                  <circle
                    cx="180"
                    cy="180"
                    r="72"
                    className="orbit-ring orbit-ring-inner"
                  />
                  <circle cx="180" cy="30" r="3.5" className="orbit-node orbit-node-accent" />
                  <circle cx="292" cy="180" r="3" className="orbit-node orbit-node-subtle" />
                  <circle cx="180" cy="292" r="2.5" className="orbit-node orbit-node-subtle" />
                </svg>

                <div className="landing-orbit-core">
                  <img
                    src="/brand/logo-mark.png"
                    alt=""
                    className="landing-orbit-mark"
                    width={84}
                    height={84}
                  />
                  <span className="landing-orbit-wordmark">AUTONEXIS</span>
                  <span className="landing-orbit-caption">{APP_TAGLINE}</span>
                </div>

                <div className="landing-orbit-pill pill-top">Private History &amp; Memory</div>
                <div className="landing-orbit-pill pill-bottom-left">Live Voice Call</div>
                <div className="landing-orbit-pill pill-bottom-right">Images &amp; Docs</div>
              </div>
            </div>
          </div>
        </section>

        {/* Below-the-fold sections lazy loaded */}
        <Suspense
          fallback={
            <footer className="landing-footer">
              <div className="landing-footer-inner">
                <div className="landing-footer-brand">
                  <span>AUTONEXIS Assistant</span>
                  <span className="landing-version-pill">{APP_VERSION}</span>
                </div>
                <nav className="landing-footer-links" aria-label="Legal and support">
                  <a href="/privacy" onClick={(e) => handleNavRoute(e, "/privacy")}>
                    Privacy
                  </a>
                  <a href="/terms" onClick={(e) => handleNavRoute(e, "/terms")}>
                    Terms
                  </a>
                  <a href="/support" onClick={(e) => handleNavRoute(e, "/support")}>
                    Support
                  </a>
                  <a href="/delete-account" onClick={(e) => handleNavRoute(e, "/delete-account")}>
                    Delete Account
                  </a>
                  <a href="/about" onClick={(e) => handleNavRoute(e, "/about")}>
                    About
                  </a>
                </nav>
              </div>
            </footer>
          }
        >
          <LandingBelowFold onFocusAuth={handleFocusAuth} />
        </Suspense>
      </main>

      {/* Shared iOS Safari Install Guide Modal (accessible while logged out on landing page) */}
      <PwaInstallModal />
    </div>
  );
};

