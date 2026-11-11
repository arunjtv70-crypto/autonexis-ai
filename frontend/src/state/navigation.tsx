import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import type { SettingsTabId, SettingsSubView } from "../components/UserMenuDropdown";

export type AppOverlayId =
  | "drawer"
  | "accountMenu"
  | "projectModal"
  | "guestModal"
  | "iosInstall"
  | "lightbox"
  | "voiceCall";

const VALID_SETTINGS_SECTIONS = new Set<SettingsTabId>([
  "account",
  "appearance",
  "personalization",
  "capabilities",
  "notifications",
  "privacy",
  "wellbeing",
  "customize",
  "language",
  "help",
  "about",
]);

const VALID_SUBVIEWS = new Set<SettingsSubView>([
  "terms",
  "privacy",
  "shortcuts",
  "support-resources",
]);

export interface ParsedRoute {
  pathname: string;
  isChat: boolean;
  isSettings: boolean;
  isExactSettingsList: boolean;
  isNotFound: boolean;
  settingsTab: SettingsTabId;
  settingsSubView: SettingsSubView;
}

export function normalizePathname(raw: string): string {
  const clean = (raw || "/").split("?")[0].split("#")[0].replace(/\/+$/, "");
  return clean === "" ? "/" : clean;
}

export function parseAppRoute(rawPath: string): ParsedRoute {
  const pathname = normalizePathname(rawPath);

  if (pathname === "/") {
    return {
      pathname,
      isChat: true,
      isSettings: false,
      isExactSettingsList: false,
      isNotFound: false,
      settingsTab: "account",
      settingsSubView: "main",
    };
  }

  if (pathname === "/settings") {
    return {
      pathname,
      isChat: false,
      isSettings: true,
      isExactSettingsList: true,
      isNotFound: false,
      settingsTab: "account",
      settingsSubView: "main",
    };
  }

  if (pathname.startsWith("/settings/")) {
    const parts = pathname.slice("/settings/".length).split("/").filter(Boolean);
    const sec = parts[0] as SettingsTabId;
    if (parts.length <= 2 && VALID_SETTINGS_SECTIONS.has(sec)) {
      if (parts.length === 1) {
        return {
          pathname,
          isChat: false,
          isSettings: true,
          isExactSettingsList: false,
          isNotFound: false,
          settingsTab: sec,
          settingsSubView: "main",
        };
      }
      const sub = parts[1] as SettingsSubView;
      const validForTab =
        (sec === "about" && (sub === "terms" || sub === "privacy" || sub === "shortcuts")) ||
        (sec === "wellbeing" && sub === "support-resources");
      if (validForTab && VALID_SUBVIEWS.has(sub)) {
        return {
          pathname,
          isChat: false,
          isSettings: true,
          isExactSettingsList: false,
          isNotFound: false,
          settingsTab: sec,
          settingsSubView: sub,
        };
      }
    }
  }

  return {
    pathname,
    isChat: false,
    isSettings: false,
    isExactSettingsList: false,
    isNotFound: true,
    settingsTab: "account",
    settingsSubView: "main",
  };
}

const PAGE_SESSION_ID =
  typeof window !== "undefined" ? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : "ssr";

interface HistorySnapshot {
  __autonexis: true;
  sessionId: string;
  seq: number;         // monotonically increasing integer per pushed state in this JS session
  path: string;        // "/", "/settings", "/settings/<section>", etc.
  overlays: AppOverlayId[];
}

interface NavigationContextValue {
  route: ParsedRoute;
  overlays: AppOverlayId[];
  hasOverlay: (id: AppOverlayId) => boolean;
  pushOverlay: (id: AppOverlayId) => void;
  closeOverlay: (id: AppOverlayId) => void;
  closeAllOverlays: () => void;
  openSettings: (tab?: SettingsTabId | null, subView?: SettingsSubView) => void;
  navigateSettings: (tab: SettingsTabId, subView?: SettingsSubView) => void;
  goBackFromSettings: () => void;
  closeSettings: () => void;
  goHome: (replace?: boolean) => void;
}

const NavigationContext = createContext<NavigationContextValue | undefined>(undefined);

export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initialPath =
    typeof window !== "undefined" ? normalizePathname(window.location.pathname) : "/";

  const [snapshot, setSnapshot] = useState<HistorySnapshot>(() => {
    if (typeof window !== "undefined") {
      // Fresh JS execution starts its own overlay/navigation sequence so overlays NEVER back across hard reloads
      const rootSnap: HistorySnapshot = {
        __autonexis: true,
        sessionId: PAGE_SESSION_ID,
        seq: 0,
        path: initialPath,
        overlays: [],
      };
      try {
        window.history.replaceState(rootSnap, "", initialPath);
      } catch {}
      return rootSnap;
    }
    return { __autonexis: true, sessionId: PAGE_SESSION_ID, seq: 0, path: "/", overlays: [] };
  });

  const snapshotRef = useRef<HistorySnapshot>(snapshot);
  snapshotRef.current = snapshot;

  // Track ordered in-session paths by seq so In-App Back knows whether the prior history step is inside Settings or Chat
  const seqPathMapRef = useRef<Map<number, string>>(
    new Map([[snapshot.seq, snapshot.path]])
  );
  const maxSeqRef = useRef<number>(snapshot.seq);
  const pendingBackLockRef = useRef<boolean>(false);
  const pendingBackResolveRef = useRef<(() => void) | null>(null);
  const opQueueRef = useRef<Promise<void>>(Promise.resolve());

  const runSerialized = useCallback((fn: () => Promise<void> | void) => {
    const next = opQueueRef.current.then(fn, fn);
    opQueueRef.current = next.catch(() => {});
    return next;
  }, []);

  const waitHistoryGo = useCallback((steps: number): Promise<void> => {
    if (steps >= 0 || typeof window === "undefined") return Promise.resolve();
    return new Promise((resolve) => {
      pendingBackLockRef.current = true;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        pendingBackLockRef.current = false;
        pendingBackResolveRef.current = null;
        resolve();
      };
      pendingBackResolveRef.current = finish;
      window.setTimeout(finish, 120);
      try {
        window.history.go(steps);
      } catch {
        finish();
      }
    });
  }, []);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const st = event.state as Partial<HistorySnapshot> | null;
      const browserPath = normalizePathname(window.location.pathname);

      if (st && st.__autonexis === true && st.sessionId === PAGE_SESSION_ID && typeof st.seq === "number") {
        const nextSnap: HistorySnapshot = {
          __autonexis: true,
          sessionId: PAGE_SESSION_ID,
          seq: st.seq,
          path: normalizePathname(st.path || browserPath),
          overlays: Array.isArray(st.overlays) ? st.overlays : [],
        };
        seqPathMapRef.current.set(nextSnap.seq, nextSnap.path);
        snapshotRef.current = nextSnap;
        setSnapshot(nextSnap);
      } else {
        const fallbackSnap: HistorySnapshot = {
          __autonexis: true,
          sessionId: PAGE_SESSION_ID,
          seq: 0,
          path: browserPath,
          overlays: [],
        };
        seqPathMapRef.current.set(0, browserPath);
        snapshotRef.current = fallbackSnap;
        setSnapshot(fallbackSnap);
      }

      if (pendingBackResolveRef.current) {
        pendingBackResolveRef.current();
      } else {
        pendingBackLockRef.current = false;
      }
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const commitPush = useCallback((nextPath: string, nextOverlays: AppOverlayId[]) => {
    const norm = normalizePathname(nextPath);
    const nextSeq = ++maxSeqRef.current;
    const nextSnap: HistorySnapshot = {
      __autonexis: true,
      sessionId: PAGE_SESSION_ID,
      seq: nextSeq,
      path: norm,
      overlays: nextOverlays,
    };
    seqPathMapRef.current.set(nextSeq, norm);
    // Prune any forward seqs above previous seq cleanly
    for (const k of Array.from(seqPathMapRef.current.keys())) {
      if (k > nextSeq) seqPathMapRef.current.delete(k);
    }
    try {
      window.history.pushState(nextSnap, "", norm);
    } catch {}
    snapshotRef.current = nextSnap;
    setSnapshot(nextSnap);
  }, []);

  const commitReplace = useCallback((nextPath: string, nextOverlays: AppOverlayId[]) => {
    const norm = normalizePathname(nextPath);
    const curSeq = snapshotRef.current.seq;
    const nextSnap: HistorySnapshot = {
      __autonexis: true,
      sessionId: PAGE_SESSION_ID,
      seq: curSeq,
      path: norm,
      overlays: nextOverlays,
    };
    seqPathMapRef.current.set(curSeq, norm);
    try {
      window.history.replaceState(nextSnap, "", norm);
    } catch {}
    snapshotRef.current = nextSnap;
    setSnapshot(nextSnap);
  }, []);

  const pushOverlay = useCallback(
    (id: AppOverlayId) => {
      if (pendingBackLockRef.current) return;
      const cur = snapshotRef.current;
      if (cur.overlays.includes(id)) return;
      commitPush(cur.path, [...cur.overlays, id]);
    },
    [commitPush]
  );

  const closeOverlay = useCallback(
    (id: AppOverlayId) => {
      if (pendingBackLockRef.current) return;
      const cur = snapshotRef.current;
      const idx = cur.overlays.lastIndexOf(id);
      if (idx === -1) return;

      // If this overlay is topmost and backed by our history step, pop cleanly so no stale entry stays in history
      if (idx === cur.overlays.length - 1 && cur.seq > 0) {
        runSerialized(() => waitHistoryGo(-1));
        return;
      }

      // Otherwise remove without leaving extra overlay stuck in state
      const remaining = cur.overlays.filter((o) => o !== id);
      commitReplace(cur.path, remaining);
    },
    [commitReplace, runSerialized, waitHistoryGo]
  );

  const closeAllOverlays = useCallback(() => {
    if (pendingBackLockRef.current) return;
    const cur = snapshotRef.current;
    if (cur.overlays.length === 0) return;

    const count = cur.overlays.length;
    if (cur.seq >= count) {
      runSerialized(() => waitHistoryGo(-count));
    } else {
      commitReplace(cur.path, []);
    }
  }, [commitReplace, runSerialized, waitHistoryGo]);

  const openSettings = useCallback(
    (tab?: SettingsTabId | null, subView: SettingsSubView = "main") => {
      if (pendingBackLockRef.current) return;

      const targetPath = !tab
        ? "/settings"
        : subView && subView !== "main"
        ? `/settings/${tab}/${subView}`
        : `/settings/${tab}`;

      runSerialized(async () => {
        const cur = snapshotRef.current;
        // Unwind any transient overlays (e.g. drawer + accountMenu) so hardware back from Settings goes straight to Chat
        if (cur.overlays.length > 0 && cur.seq >= cur.overlays.length) {
          await waitHistoryGo(-cur.overlays.length);
        } else if (cur.overlays.length > 0) {
          commitReplace(cur.path, []);
        }

        const after = snapshotRef.current;
        if (after.path === targetPath) return;

        // Ensure opening a specific section directly from Chat pushes "/settings" beneath it so Back steps: section -> list -> chat
        if (!after.path.startsWith("/settings") && targetPath !== "/settings") {
          commitPush("/settings", []);
        }
        if (targetPath !== "/settings") {
          if (snapshotRef.current.path !== targetPath) {
            commitPush(targetPath, []);
          }
        } else {
          commitPush("/settings", []);
        }
      });
    },
    [commitPush, commitReplace, runSerialized, waitHistoryGo]
  );

  const navigateSettings = useCallback(
    (tab: SettingsTabId, subView: SettingsSubView = "main") => {
      if (pendingBackLockRef.current) return;
      const nextPath =
        subView && subView !== "main" ? `/settings/${tab}/${subView}` : `/settings/${tab}`;
      const cur = snapshotRef.current;
      if (cur.path === nextPath && cur.overlays.length === 0) return;
      commitPush(nextPath, []);
    },
    [commitPush]
  );

  const goBackFromSettings = useCallback(() => {
    if (pendingBackLockRef.current) return;
    const cur = snapshotRef.current;

    if (cur.overlays.length > 0 && cur.seq > 0) {
      runSerialized(() => waitHistoryGo(-1));
      return;
    }

    const prevSeq = cur.seq - 1;
    const prevPath = prevSeq >= 0 ? seqPathMapRef.current.get(prevSeq) : undefined;
    const parsed = parseAppRoute(cur.path);

    if (parsed.isExactSettingsList) {
      if (prevPath === "/") {
        runSerialized(() => waitHistoryGo(-1));
      } else {
        commitReplace("/", []);
      }
      return;
    }

    if (parsed.isSettings) {
      // Currently inside a section or subview
      if (prevPath && prevPath.startsWith("/settings")) {
        runSerialized(() => waitHistoryGo(-1));
      } else {
        // Cold deep-link or direct entry without a prior /settings entry: go safely to /settings list without exiting app
        commitReplace("/settings", []);
      }
      return;
    }

    commitReplace("/", []);
  }, [commitReplace, runSerialized, waitHistoryGo]);

  const closeSettings = useCallback(() => {
    if (pendingBackLockRef.current) return;
    runSerialized(async () => {
      const cur = snapshotRef.current;
      // If an overlay is open above Settings, unwind it too
      let stepsBack = cur.overlays.length;
      let checkSeq = cur.seq - cur.overlays.length;

      // Count how many contiguous /settings* entries belong to this in-session modal visit back to "/"
      let foundHomeBeforeSettings = false;
      while (checkSeq > 0) {
        const p = seqPathMapRef.current.get(checkSeq);
        if (p && p.startsWith("/settings")) {
          stepsBack++;
          checkSeq--;
        } else {
          if (p === "/") foundHomeBeforeSettings = true;
          break;
        }
      }
      if (checkSeq === 0 && seqPathMapRef.current.get(0) === "/") {
        foundHomeBeforeSettings = true;
      }

      if (foundHomeBeforeSettings && stepsBack > 0) {
        await waitHistoryGo(-stepsBack);
      } else {
        commitReplace("/", []);
      }
    });
  }, [commitReplace, runSerialized, waitHistoryGo]);

  const goHome = useCallback(
    (replace = false) => {
      if (pendingBackLockRef.current) return;
      if (replace) {
        commitReplace("/", []);
      } else {
        commitPush("/", []);
      }
    },
    [commitPush, commitReplace]
  );

  const route = parseAppRoute(snapshot.path);
  const hasOverlay = useCallback(
    (id: AppOverlayId) => snapshot.overlays.includes(id),
    [snapshot.overlays]
  );

  return (
    <NavigationContext.Provider
      value={{
        route,
        overlays: snapshot.overlays,
        hasOverlay,
        pushOverlay,
        closeOverlay,
        closeAllOverlays,
        openSettings,
        navigateSettings,
        goBackFromSettings,
        closeSettings,
        goHome,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
};

export function useAppNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) {
    throw new Error("useAppNavigation must be used within NavigationProvider");
  }
  return ctx;
}
