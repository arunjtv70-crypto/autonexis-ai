import React from "react";
import { APP_NAME, APP_VERSION, FEATURE_FLAGS } from "../config";
import { PLAY_STORE_URL, APK_URL, APK_VERSION_NOTE } from "../config/downloads";
import { usePwa } from "../state/pwa";
import { useAppNavigation } from "../state/navigation";
import { detectVisitorPlatform } from "../utils/appMode";
import { Button } from "../components/Button";
import { Logo } from "../components/Logo";
import {
  IconSparkles,
  IconImage,
  IconPhone,
  IconFileText,
  IconSmartphone,
  IconDevice,
  IconDownload,
  IconExternalLink,
} from "../components/Icons";

interface LandingBelowFoldProps {
  onFocusAuth: () => void;
}

const FEATURE_CARDS = [
  {
    key: "chat" as const,
    icon: IconSparkles,
    title: "Calm Chat, Memory & Projects",
    description:
      "Have private conversations with custom writing styles, organize work into Projects, manage memories cleanly, or switch to Temporary Chat that leaves zero history behind.",
  },
  {
    key: "images" as const,
    icon: IconImage,
    title: "Image Creation",
    description:
      "Describe a scene or concept naturally in English, Hindi, or Hinglish to generate private images stored directly in your conversation.",
  },
  {
    key: "voice" as const,
    icon: IconPhone,
    title: "Live Voice Call",
    description:
      "Talk back and forth naturally in real time with live captions and clear voice playback — a live voice conversation, not a static voice memo.",
  },
  {
    key: "files" as const,
    icon: IconFileText,
    title: "Documents, PDFs & Cited Search",
    description:
      "Upload PDFs, text files, or reference images to reason through together, and fetch up-to-date answers with linked web sources.",
  },
];

const FAQ_ITEMS = [
  {
    q: "Can I try AUTONEXIS Assistant without signing up?",
    a: "Yes. Click “Try without login” right inside the sign-in card above to start a guest conversation in your browser with zero account required.",
  },
  {
    q: "What is the difference between regular chats and Temporary Chat?",
    a: "Signed-in conversations and saved memories persist privately under your account so you can revisit them across devices. Temporary Chat stays strictly inside your active tab and is never saved to cloud history or memory.",
  },
  {
    q: "How does voice conversation handle my audio?",
    a: "Live Voice Call processes spoken audio turn by turn for speech recognition so the assistant can respond promptly. Spoken audio recordings are not permanently stored.",
  },
  {
    q: "Where can I install the Android or Desktop app?",
    a: "AUTONEXIS runs as an installable web app on desktop Chrome/Edge, iOS Safari, and Android Chrome. A dedicated Android store release is being prepared alongside this unified app.",
  },
];

const LandingBelowFold: React.FC<LandingBelowFoldProps> = ({ onFocusAuth }) => {
  const { canPromptInstall, isIos, isInstalled, triggerInstall } = usePwa();
  const { navigateTo } = useAppNavigation();
  const visitorPlatform = detectVisitorPlatform();

  const enabledFeatures = FEATURE_CARDS.filter((f) => FEATURE_FLAGS[f.key]);

  const handleInternalLink = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    e.preventDefault();
    navigateTo(path);
  };

  return (
    <>
      {/* Features Grid */}
      {enabledFeatures.length > 0 && (
        <section id="features" className="landing-section" aria-labelledby="features-heading">
          <div className="landing-section-inner">
            <div className="landing-section-head">
              <span className="landing-eyebrow">Capabilities</span>
              <h2 id="features-heading" className="landing-section-title">
                Built for focused work and everyday clarity
              </h2>
              <p className="landing-section-sub">
                Every tool shown here works inside the assistant today — no waitlist promises.
              </p>
            </div>

            <div className="landing-features-grid">
              {enabledFeatures.map((item) => {
                const Icon = item.icon;
                return (
                  <article key={item.key} className="landing-feature-card">
                    <div className="landing-feature-icon" aria-hidden="true">
                      <Icon size={20} />
                    </div>
                    <h3 className="landing-feature-title">{item.title}</h3>
                    <p className="landing-feature-desc">{item.description}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Get the App (browser-only download/install section) */}
      <section
        id="get-the-app"
        className="landing-section landing-section-alt"
        data-browser-only="true"
        aria-labelledby="get-app-heading"
      >
        <div className="landing-section-inner">
          <div className="landing-section-head">
            <span className="landing-eyebrow">Install &amp; Mobile</span>
            <h2 id="get-app-heading" className="landing-section-title">
              Get the app on your device
            </h2>
            <p className="landing-section-sub">
              One unified codebase tailored for your browser today and full-screen app launch on phones and desktop.
            </p>
          </div>

          <div className="landing-download-grid">
            {/* Android Card */}
            <article
              className={`landing-download-card ${visitorPlatform === "android" ? "is-highlighted" : ""}`}
            >
              <div className="landing-download-top">
                <div className="landing-download-platform">
                  <IconSmartphone size={18} />
                  <span>Android</span>
                </div>
                {visitorPlatform === "android" && (
                  <span className="landing-device-badge">Your device</span>
                )}
              </div>

              {PLAY_STORE_URL ? (
                <>
                  <p className="landing-download-copy">
                    Download the official Android app from Google Play for a dedicated home-screen experience.
                  </p>
                  <div className="landing-download-actions">
                    <a
                      href={PLAY_STORE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="landing-link-btn"
                    >
                      <Button variant="primary" size="md" fullWidth>
                        <span>Get on Google Play</span>
                        <IconExternalLink size={15} />
                      </Button>
                    </a>
                  </div>
                </>
              ) : APK_URL ? (
                <>
                  <p className="landing-download-copy">
                    Direct Android preview build {APK_VERSION_NOTE ? `(${APK_VERSION_NOTE})` : ""}. Install cleanly outside the Play Store during beta testing.
                  </p>
                  <div className="landing-download-actions">
                    <a
                      href={APK_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="landing-link-btn"
                    >
                      <Button variant="primary" size="md" fullWidth>
                        <IconDownload size={15} />
                        <span>Download APK (Beta)</span>
                      </Button>
                    </a>
                  </div>
                </>
              ) : (
                <>
                  <div className="landing-status-pill">Android Store release coming soon</div>
                  <p className="landing-download-copy">
                    Open this page in Chrome on Android, tap the menu (<strong>&vellip;</strong>), and choose{" "}
                    <strong>Install app</strong> or <strong>Add to Home screen</strong> to launch full-screen immediately.
                  </p>
                  {canPromptInstall && (
                    <div className="landing-download-actions">
                      <Button variant="primary" size="md" fullWidth onClick={() => triggerInstall()}>
                        <IconDownload size={15} />
                        <span>Install Android Web App</span>
                      </Button>
                    </div>
                  )}
                </>
              )}
            </article>

            {/* Windows / Desktop Card */}
            <article
              className={`landing-download-card ${visitorPlatform === "desktop" ? "is-highlighted" : ""}`}
            >
              <div className="landing-download-top">
                <div className="landing-download-platform">
                  <IconDevice size={18} />
                  <span>Windows &amp; Desktop</span>
                </div>
                {visitorPlatform === "desktop" && (
                  <span className="landing-device-badge">Your device</span>
                )}
              </div>

              <p className="landing-download-copy">
                {isInstalled
                  ? "Installed on this device — launch directly from your Start menu or Applications folder."
                  : canPromptInstall
                  ? "Install AUTONEXIS Assistant as a standalone desktop window with instant launch and cleaner focus."
                  : "In Chrome or Edge on desktop, click the install icon in your address bar (or browser menu -> Install AUTONEXIS Assistant)."}
              </p>

              {canPromptInstall && !isInstalled && (
                <div className="landing-download-actions">
                  <Button variant="primary" size="md" fullWidth onClick={() => triggerInstall()}>
                    <IconDownload size={15} />
                    <span>Install Desktop App</span>
                  </Button>
                </div>
              )}
            </article>

            {/* iOS Card */}
            <article
              className={`landing-download-card ${visitorPlatform === "ios" ? "is-highlighted" : ""}`}
            >
              <div className="landing-download-top">
                <div className="landing-download-platform">
                  <IconSmartphone size={18} />
                  <span>iPhone &amp; iPad</span>
                </div>
                {visitorPlatform === "ios" && (
                  <span className="landing-device-badge">Your device</span>
                )}
              </div>

              <ol className="landing-ios-steps">
                <li>Open this page in <strong>Safari</strong></li>
                <li>Tap the <strong>Share</strong> icon in the toolbar</li>
                <li>Select <strong>Add to Home Screen</strong></li>
              </ol>

              {isIos && (
                <div className="landing-download-actions">
                  <Button variant="outline" size="md" fullWidth onClick={() => triggerInstall()}>
                    <span>Open iOS Install Guide</span>
                  </Button>
                </div>
              )}
            </article>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="landing-section" aria-labelledby="faq-heading">
        <div className="landing-section-inner landing-faq-wrap">
          <div className="landing-section-head">
            <span className="landing-eyebrow">Questions</span>
            <h2 id="faq-heading" className="landing-section-title">
              Clear answers before you start
            </h2>
          </div>

          <div className="landing-faq-list">
            {FAQ_ITEMS.map((item) => (
              <details key={item.q} className="landing-faq-item">
                <summary className="landing-faq-q">{item.q}</summary>
                <p className="landing-faq-a">{item.a}</p>
              </details>
            ))}
          </div>

          <div className="landing-bottom-cta">
            <p className="landing-bottom-cta-text">Ready to begin?</p>
            <Button variant="primary" size="md" onClick={onFocusAuth}>
              Open Sign In / Try Guest
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-brand">
            <Logo variant="mark" size="xs" tile="none" />
            <span>{APP_NAME}</span>
            <span className="landing-version-pill">{APP_VERSION}</span>
          </div>

          <nav className="landing-footer-links" aria-label="Legal and support">
            <a href="/privacy" onClick={(e) => handleInternalLink(e, "/privacy")}>
              Privacy
            </a>
            <a href="/terms" onClick={(e) => handleInternalLink(e, "/terms")}>
              Terms
            </a>
            <a href="/support" onClick={(e) => handleInternalLink(e, "/support")}>
              Support
            </a>
            <a href="/delete-account" onClick={(e) => handleInternalLink(e, "/delete-account")}>
              Delete Account
            </a>
            <a href="/about" onClick={(e) => handleInternalLink(e, "/about")}>
              About
            </a>
          </nav>
        </div>
      </footer>
    </>
  );
};

export default LandingBelowFold;

