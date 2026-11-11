import React from "react";
import { APP_NAME, APP_TAGLINE, APP_VERSION, LEGAL_DRAFT_NOTICE, SUPPORT_EMAIL } from "../config";
import { useAppNavigation, type LegalPageId } from "../state/navigation";
import { isAppMode } from "../utils/appMode";
import { Logo } from "../components/Logo";
import { Button } from "../components/Button";
import { IconChevronRight, IconShield, IconFileText, IconHelpCircle, IconTrash, IconInfo } from "../components/Icons";
import "./LegalPageScreen.css";

interface LegalPageScreenProps {
  page: LegalPageId;
}

const LEGAL_TABS: Array<{ id: LegalPageId; path: string; label: string }> = [
  { id: "privacy", path: "/privacy", label: "Privacy" },
  { id: "terms", path: "/terms", label: "Terms" },
  { id: "support", path: "/support", label: "Support" },
  { id: "delete-account", path: "/delete-account", label: "Delete Account" },
  { id: "about", path: "/about", label: "About" },
];

export const LegalPageScreen: React.FC<LegalPageScreenProps> = ({ page }) => {
  const { navigateTo, goBackOrHome } = useAppNavigation();
  const inAppMode = isAppMode();
  const hasSupportEmail = SUPPORT_EMAIL.trim().length > 0;

  const handleLink = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    e.preventDefault();
    navigateTo(path);
  };

  return (
    <div className="legal-page">
      <header className="legal-header">
        <div className="legal-header-inner">
          <div className="legal-header-left">
            <Button variant="ghost" size="sm" onClick={() => goBackOrHome()} aria-label="Back">
              <span className="legal-back-icon" aria-hidden="true">
                <IconChevronRight size={15} />
              </span>
              <span>Back</span>
            </Button>

            <a
              href="/"
              className="legal-brand-link"
              onClick={(e) => handleLink(e, "/")}
              aria-label={APP_NAME}
            >
              <Logo variant="full" size="xs" layout="inline" tile="none" showSubtitle={false} />
            </a>
          </div>

          <span className="legal-draft-badge" role="note">
            {LEGAL_DRAFT_NOTICE}
          </span>
        </div>

        <nav className="legal-tabs-nav" aria-label="Legal and informational pages">
          {LEGAL_TABS.map((tab) => (
            <a
              key={tab.id}
              href={tab.path}
              className={`legal-tab-link ${page === tab.id ? "active" : ""}`}
              onClick={(e) => handleLink(e, tab.path)}
              aria-current={page === tab.id ? "page" : undefined}
            >
              {tab.label}
            </a>
          ))}
        </nav>
      </header>

      <main className="legal-main">
        <article className="legal-card legal-page-content">
          {page === "privacy" && (
            <>
              <div className="legal-title-row">
                <IconShield size={22} className="legal-title-icon" />
                <h1 className="legal-title">Privacy Policy</h1>
              </div>
              <p className="legal-lead">
                Plain-language overview of what information {APP_NAME} uses, what stays on your device, and what you control.
              </p>

              <section className="legal-section">
                <h2>1. Account &amp; Authentication</h2>
                <p>
                  When you sign in with email/password or your Google account, your identity token is verified so your workspace belongs only to you. We never share your conversations or preferences with other user accounts.
                </p>
              </section>

              <section className="legal-section">
                <h2>2. Chats, Memories, Projects &amp; Settings</h2>
                <p>
                  When signed in, your saved conversations, Projects, custom styles, saved memories, preferences, and problem reports you submit are stored in your private account storage. You control these items and can export or delete saved chats and memories inside <strong>Settings &rarr; Privacy</strong>.
                </p>
              </section>

              <section className="legal-section">
                <h2>3. Temporary Chat &amp; Guest Mode</h2>
                <p>
                  Messages sent inside <strong>Temporary Chat</strong> live only in browser tab memory for the active conversation and are never saved to your cloud chat history or long-term memory.
                </p>
                <p>
                  If you use <strong>Guest mode</strong> (“Try without login”), guest messages stay strictly in your browser&apos;s local storage and can be wiped anytime using <strong>Settings &rarr; Privacy &rarr; Clear data on this device</strong>.
                </p>
              </section>

              <section className="legal-section">
                <h2>4. Image Generation</h2>
                <p>
                  When you ask for an image, your image prompt is sent through our server to a third-party image generation service so the image is generated privately without attaching personal profile details. Up to your latest 20 generated images remain saved privately in cloud storage alongside your conversation until you delete the chat or image.
                </p>
              </section>

              <section className="legal-section">
                <h2>5. Voice &amp; Speech-to-Text</h2>
                <p>
                  Voice dictation and Live Voice Call convert speech into text using your browser&apos;s built-in speech capability or our server speech-to-text endpoint for that turn. Spoken audio clips are processed only for transcription and are <strong>not permanently stored</strong>.
                </p>
              </section>

              <section className="legal-section">
                <h2>6. Web Search</h2>
                <p>
                  When web search is needed to verify current information, your search query is forwarded through our backend to a third-party web search service to gather public sources and citations.
                </p>
              </section>

              <section className="legal-section">
                <h2>7. Export &amp; Account Deletion</h2>
                <p>
                  You can export your data anytime inside <strong>Settings &rarr; Privacy &rarr; Export my data</strong>. Instructions for deleting chats, clearing local data, or requesting full account removal are detailed on our{" "}
                  <a href="/delete-account" onClick={(e) => handleLink(e, "/delete-account")}>
                    Delete Account
                  </a>{" "}
                  page.
                </p>
              </section>
            </>
          )}

          {page === "terms" && (
            <>
              <div className="legal-title-row">
                <IconFileText size={22} className="legal-title-icon" />
                <h1 className="legal-title">Terms of Use</h1>
              </div>
              <p className="legal-lead">
                Simple, transparent terms for using {APP_NAME}.
              </p>

              <section className="legal-section">
                <h2>1. AI Output Disclaimer</h2>
                <p>
                  {APP_NAME} generates responses, summaries, code, and images automatically. Automated outputs can be incomplete or inaccurate. Please double-check important facts and do not rely solely on AI responses for medical, legal, financial, or safety-critical decisions.
                </p>
              </section>

              <section className="legal-section">
                <h2>2. Your Workspace &amp; Content</h2>
                <p>
                  You retain responsibility for the text, files, PDFs, and prompts you enter or upload. Only upload material you have the right to share and process.
                </p>
              </section>

              <section className="legal-section">
                <h2>3. Acceptable Use</h2>
                <p>Please do not use {APP_NAME} to:</p>
                <ul>
                  <li>Break applicable laws or engage in illegal activity</li>
                  <li>Harass, exploit, threaten, or impersonate others</li>
                  <li>Request sexually explicit, non-consensual, or harmful imagery</li>
                  <li>Probe, disrupt, or bypass security, authentication, or safety filters</li>
                </ul>
              </section>

              <section className="legal-section">
                <h2>4. Service Changes</h2>
                <p>
                  Features, usage limits, and availability may evolve cleanly over time as {APP_NAME} improves.
                </p>
              </section>
            </>
          )}

          {page === "support" && (
            <>
              <div className="legal-title-row">
                <IconHelpCircle size={22} className="legal-title-icon" />
                <h1 className="legal-title">Support</h1>
              </div>
              <p className="legal-lead">
                Need help with sign-in, voice calls, uploads, or app installation?
              </p>

              <section className="legal-section">
                <h2>In-App Problem Reporting</h2>
                <p>
                  When signed in, open <strong>Settings &rarr; Help &rarr; Report a problem</strong> inside the assistant to describe an issue directly from your workspace.
                </p>
              </section>

              <section className="legal-section">
                <h2>Direct Email Support</h2>
                {hasSupportEmail ? (
                  <p>
                    You can reach support directly at{" "}
                    <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
                  </p>
                ) : (
                  <p>
                    A dedicated support email address will be published here prior to public app-store launch. In the meantime, signed-in users can send feedback via <strong>Settings &rarr; Help</strong>.
                  </p>
                )}
              </section>

              <section className="legal-section">
                <h2>Quick Help Topics</h2>
                <ul>
                  <li>
                    <strong>Microphone / Voice Call:</strong> Ensure browser microphone permission is granted for this site and retry cleanly.
                  </li>
                  {!inAppMode && (
                    <li>
                      <strong>Installing the App:</strong> On desktop Chrome or Edge use the address bar install button; on iOS Safari use Share &rarr; Add to Home Screen.
                    </li>
                  )}
                  <li>
                    <strong>Account &amp; Privacy:</strong> Review{" "}
                    <a href="/privacy" onClick={(e) => handleLink(e, "/privacy")}>
                      Privacy Policy
                    </a>{" "}
                    or{" "}
                    <a href="/delete-account" onClick={(e) => handleLink(e, "/delete-account")}>
                      Delete Account
                    </a>
                    .
                  </li>
                </ul>
              </section>
            </>
          )}

          {page === "delete-account" && (
            <>
              <div className="legal-title-row">
                <IconTrash size={22} className="legal-title-icon" />
                <h1 className="legal-title">Account &amp; Data Deletion</h1>
              </div>
              <p className="legal-lead">
                How to remove your conversations, memories, or request full account deletion.
              </p>

              <section className="legal-section">
                <h2>1. Delete Chats, Memories, or Device Data Yourself</h2>
                <ul>
                  <li>
                    <strong>Export first (optional):</strong> Open <strong>Settings &rarr; Privacy &rarr; Export my data</strong> to download a copy of your chats, preferences, and saved memories.
                  </li>
                  <li>
                    <strong>Delete chat history &amp; memories:</strong> Delete individual threads from the sidebar or clear memories inside <strong>Settings &rarr; Personalization / Privacy</strong>.
                  </li>
                  <li>
                    <strong>Guest mode on this device:</strong> Open <strong>Settings &rarr; Privacy &rarr; Clear data on this device</strong>.
                  </li>
                </ul>
              </section>

              <section className="legal-section">
                <h2>2. Full Account Deletion Request</h2>
                <p>
                  Automated one-click self-serve permanent account deletion is not yet available directly inside the app settings in {APP_VERSION}.
                </p>
                {hasSupportEmail ? (
                  <p>
                    To permanently delete your account and all associated cloud data, send an email from your registered address to{" "}
                    <a href={`mailto:${SUPPORT_EMAIL}?subject=Account%20Deletion%20Request`}>
                      {SUPPORT_EMAIL}
                    </a>{" "}
                    with the subject <strong>Account Deletion Request</strong>.
                  </p>
                ) : (
                  <p>
                    Before public Play Store launch, a direct deletion contact email and self-serve deletion flow will be enabled here so you can trigger permanent account removal from both web and mobile.
                  </p>
                )}
              </section>

              <section className="legal-section">
                <h2>3. Data Removed Upon Full Deletion</h2>
                <p>
                  When a full account deletion is completed, your account login record, saved chats, generated images stored for your account, saved memories, Projects, preferences, and submitted problem reports are permanently removed.
                </p>
              </section>
            </>
          )}

          {page === "about" && (
            <>
              <div className="legal-title-row">
                <IconInfo size={22} className="legal-title-icon" />
                <h1 className="legal-title">About {APP_NAME}</h1>
              </div>
              <p className="legal-lead">
                {APP_TAGLINE} — built as one calm, unified workspace across browser and installed app ({APP_VERSION}).
              </p>

              <section className="legal-section">
                <h2>What {APP_NAME} Offers</h2>
                <p>
                  {APP_NAME} brings private conversations, custom styles, saved memories, Projects, natural live voice calls, private image generation, PDF/file reading, and cited web search together behind a quiet, distraction-free interface.
                </p>
              </section>

              <section className="legal-section">
                <h2>Helpful Links</h2>
                <ul>
                  <li>
                    <a href="/privacy" onClick={(e) => handleLink(e, "/privacy")}>
                      Privacy Policy
                    </a>
                  </li>
                  <li>
                    <a href="/terms" onClick={(e) => handleLink(e, "/terms")}>
                      Terms of Use
                    </a>
                  </li>
                  <li>
                    <a href="/support" onClick={(e) => handleLink(e, "/support")}>
                      Support
                    </a>
                  </li>
                  <li>
                    <a href="/delete-account" onClick={(e) => handleLink(e, "/delete-account")}>
                      Account &amp; Data Deletion
                    </a>
                  </li>
                </ul>
              </section>

              <div className="legal-cta-row">
                <Button variant="primary" size="md" onClick={() => navigateTo("/")}>
                  Open {APP_NAME}
                </Button>
              </div>
            </>
          )}
        </article>
      </main>
    </div>
  );
};

