import React from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { usePwa } from "../state/pwa";
import { IconShare, IconPlusSquare, IconCheck, IconSmartphone } from "./Icons";

export const PwaInstallModal: React.FC = () => {
  const { showIosSheet, setShowIosSheet, isIosNonSafari } = usePwa();

  return (
    <Modal
      isOpen={showIosSheet}
      onClose={() => setShowIosSheet(false)}
      title="Install AUTONEXIS Assistant"
      maxWidth="440px"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", padding: "0.25rem 0" }}>
        {isIosNonSafari ? (
          <div
            style={{
              padding: "1rem",
              borderRadius: "10px",
              backgroundColor: "rgba(234, 179, 8, 0.1)",
              border: "1px solid rgba(234, 179, 8, 0.3)",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 500 }}>
              <IconSmartphone size={18} />
              <span>Open in Safari First</span>
            </div>
            <p style={{ fontSize: "0.86rem", lineHeight: 1.5, color: "var(--text-secondary)", margin: 0 }}>
              On iPhone and iPad, installing web apps is supported inside Safari. Please copy this page link and open it in <strong>Safari</strong> first, then tap Share &rarr; Add to Home Screen.
            </p>
          </div>
        ) : (
          <>
            <p style={{ fontSize: "0.86rem", color: "var(--text-secondary)", margin: 0, lineHeight: 1.45 }}>
              Add AUTONEXIS Assistant to your Home Screen for quick full-screen access:
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "0.75rem",
                  borderRadius: "10px",
                  backgroundColor: "var(--surface-raised)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div
                  style={{
                    width: "34px",
                    height: "34px",
                    borderRadius: "8px",
                    backgroundColor: "rgba(200, 169, 126, 0.15)",
                    color: "var(--accent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <IconShare size={18} />
                </div>
                <div style={{ fontSize: "0.86rem" }}>
                  <strong>Step 1:</strong> Tap the <strong>Share</strong> button in Safari&apos;s toolbar.
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "0.75rem",
                  borderRadius: "10px",
                  backgroundColor: "var(--surface-raised)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div
                  style={{
                    width: "34px",
                    height: "34px",
                    borderRadius: "8px",
                    backgroundColor: "rgba(200, 169, 126, 0.15)",
                    color: "var(--accent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <IconPlusSquare size={18} />
                </div>
                <div style={{ fontSize: "0.86rem" }}>
                  <strong>Step 2:</strong> Scroll down and choose <strong>&ldquo;Add to Home Screen&rdquo;</strong>.
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "0.75rem",
                  borderRadius: "10px",
                  backgroundColor: "var(--surface-raised)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div
                  style={{
                    width: "34px",
                    height: "34px",
                    borderRadius: "8px",
                    backgroundColor: "rgba(200, 169, 126, 0.15)",
                    color: "var(--accent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <IconCheck size={18} />
                </div>
                <div style={{ fontSize: "0.86rem" }}>
                  <strong>Step 3:</strong> Tap <strong>&ldquo;Add&rdquo;</strong> in the top corner.
                </div>
              </div>
            </div>
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.25rem" }}>
          <Button variant="primary" size="sm" onClick={() => setShowIosSheet(false)}>
            Got it
          </Button>
        </div>
      </div>
    </Modal>
  );
};
