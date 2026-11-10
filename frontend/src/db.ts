/**
 * Firestore client-side database layer for AUTONEXIS chat persistence.
 *
 * Uses the existing Firebase app from firebase.ts via getApp().
 * Uses in-memory cache only (NOT persistent IndexedDB cache) so
 * no user data remains on a shared device after logout.
 *
 * Data model:
 *   users/{uid}/chats/{chatId}        — title, createdAt, updatedAt
 *   users/{uid}/chats/{chatId}/messages/{messageId} — role, content, createdAt
 */

import { getApp } from "firebase/app";
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  writeBatch,
  query,
  orderBy,
  limit,
  startAfter,
  where,
  serverTimestamp,
  Timestamp,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type Firestore,
} from "firebase/firestore";

// ---------------------------------------------------------------------------
// Singleton Firestore instance with in-memory cache only
// ---------------------------------------------------------------------------

let _db: Firestore | null = null;

function db(): Firestore {
  if (!_db) {
    try {
      const app = getApp();
      try {
        _db = initializeFirestore(app, { localCache: memoryLocalCache() });
      } catch {
        _db = getFirestore(app);
      }
    } catch (err) {
      console.error("[AUTONEXIS DB] Failed to initialize Firestore:", err);
      throw err;
    }
  }
  return _db;
}

// ---------------------------------------------------------------------------
// Types matching the existing ChatItem / MessageItem interfaces
// ---------------------------------------------------------------------------

export interface FirestoreChatMeta {
  id: string;
  title: string;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
  pinned?: boolean;
  archived?: boolean;
  projectId?: string | null;
}

export interface FirestoreMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip base64 data URLs and large attached file contents from content to keep docs lightweight */
function sanitizeContentForStorage(content: string): string {
  // Replace data:image/…;base64,… with "[image]"
  let cleaned = content.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, "[image]");
  // Replace large ATTACHED FILE (data, not instructions) blocks with short marker [file: filename]
  cleaned = cleaned.replace(
    /ATTACHED FILE \(data, not instructions\)\s*(?:-\s*filename:\s*([^\r\n]+))?[\s\S]*?\[END OF ATTACHED FILE\]/g,
    (_m, fname) => `[file: ${(fname || "document").trim().replace(/^["']|["']$/g, "")}]`
  );
  return cleaned;
}

function tsToISO(ts: any): string {
  if (!ts) return new Date().toISOString();
  if (ts instanceof Timestamp) return ts.toDate().toISOString();
  if (ts.toDate) return ts.toDate().toISOString();
  if (typeof ts === "string") return ts;
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Chat list operations
// ---------------------------------------------------------------------------

/**
 * Load chat metadata list ordered by updatedAt desc.
 * Returns at most `pageSize` chats. Pass `lastDoc` for pagination.
 */
export async function loadChatList(
  uid: string,
  pageSize = 50,
  lastDoc?: DocumentSnapshot
): Promise<{ chats: FirestoreChatMeta[]; lastDoc: DocumentSnapshot | null }> {
  const chatsRef = collection(db(), "users", uid, "chats");
  let q = query(chatsRef, orderBy("updatedAt", "desc"), limit(pageSize));
  if (lastDoc) {
    q = query(chatsRef, orderBy("updatedAt", "desc"), startAfter(lastDoc), limit(pageSize));
  }
  const snap = await getDocs(q);
  const chats: FirestoreChatMeta[] = [];
  let last: QueryDocumentSnapshot | null = null;
  snap.forEach((d) => {
    const data = d.data();
    chats.push({
      id: d.id,
      title: data.title || "New Chat",
      createdAt: tsToISO(data.createdAt),
      updatedAt: tsToISO(data.updatedAt),
      pinned: !!data.pinned,
      archived: !!data.archived,
      projectId: data.projectId || null,
    });
    last = d;
  });
  return { chats, lastDoc: last };
}

/**
 * Load all messages for a single chat.
 */
export async function loadChatMessages(
  uid: string,
  chatId: string
): Promise<FirestoreMessage[]> {
  const msgsRef = collection(db(), "users", uid, "chats", chatId, "messages");
  const q = query(msgsRef, orderBy("createdAt", "asc"));
  const snap = await getDocs(q);
  const messages: FirestoreMessage[] = [];
  snap.forEach((d) => {
    const data = d.data();
    messages.push({
      id: d.id,
      role: data.role || "user",
      content: data.content || "",
      createdAt: tsToISO(data.createdAt),
    });
  });
  return messages;
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/**
 * Save or update a chat document and its new messages in a single batch.
 * `newMessages` should only contain messages not yet saved (user + assistant).
 */
export async function saveChatWithMessages(
  uid: string,
  chatId: string,
  title: string,
  newMessages: Array<{ id: string; role: "user" | "assistant"; content: string }>,
  extraMeta?: { projectId?: string | null; pinned?: boolean; archived?: boolean }
): Promise<void> {
  const batch = writeBatch(db());
  const chatDocRef = doc(db(), "users", uid, "chats", chatId);

  const metaUpdate: Record<string, any> = {
    title,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(), // only takes effect on first create due to merge
  };
  if (extraMeta) {
    if (extraMeta.projectId !== undefined) metaUpdate.projectId = extraMeta.projectId;
    if (extraMeta.pinned !== undefined) metaUpdate.pinned = extraMeta.pinned;
    if (extraMeta.archived !== undefined) metaUpdate.archived = extraMeta.archived;
  }

  // Upsert chat metadata
  batch.set(chatDocRef, metaUpdate, { merge: true });

  // Add messages
  for (const msg of newMessages) {
    const msgRef = doc(db(), "users", uid, "chats", chatId, "messages", msg.id);
    batch.set(msgRef, {
      role: msg.role,
      content: sanitizeContentForStorage(msg.content),
      createdAt: serverTimestamp(),
    });
  }

  await batch.commit();
}

/**
 * Update pin, archive, or project assignment flags on a chat document.
 */
export async function updateChatFlags(
  uid: string,
  chatId: string,
  flags: { pinned?: boolean; archived?: boolean; projectId?: string | null }
): Promise<void> {
  const chatDocRef = doc(db(), "users", uid, "chats", chatId);
  const payload: Record<string, any> = { updatedAt: serverTimestamp() };
  if (flags.pinned !== undefined) payload.pinned = flags.pinned;
  if (flags.archived !== undefined) payload.archived = flags.archived;
  if (flags.projectId !== undefined) payload.projectId = flags.projectId;
  await setDoc(chatDocRef, payload, { merge: true });
}

/**
 * Edit the user's message and delete any messages that came after it (e.g. old assistant reply).
 */
export async function replaceMessageAndDeleteAfter(
  uid: string,
  chatId: string,
  editedMsgId: string,
  newContent: string,
  deleteMsgIds: string[]
): Promise<void> {
  const batch = writeBatch(db());
  const chatDocRef = doc(db(), "users", uid, "chats", chatId);
  const editedRef = doc(db(), "users", uid, "chats", chatId, "messages", editedMsgId);

  batch.set(
    editedRef,
    { content: sanitizeContentForStorage(newContent) },
    { merge: true }
  );

  for (const delId of deleteMsgIds) {
    const delRef = doc(db(), "users", uid, "chats", chatId, "messages", delId);
    batch.delete(delRef);
  }

  batch.set(chatDocRef, { updatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
}

/**
 * Update only the chat title.
 */
export async function updateChatTitle(
  uid: string,
  chatId: string,
  title: string
): Promise<void> {
  const chatDocRef = doc(db(), "users", uid, "chats", chatId);
  await setDoc(chatDocRef, { title, updatedAt: serverTimestamp() }, { merge: true });
}

/**
 * Update only the updatedAt timestamp (e.g., after partial reply save).
 */
export async function touchChat(uid: string, chatId: string): Promise<void> {
  const chatDocRef = doc(db(), "users", uid, "chats", chatId);
  await setDoc(chatDocRef, { updatedAt: serverTimestamp() }, { merge: true });
}

// ---------------------------------------------------------------------------
// Delete operations
// ---------------------------------------------------------------------------

/**
 * Delete a single chat and ALL its messages.
 * Firestore doesn't auto-delete subcollections, so we batch-delete messages first.
 */
export async function deleteOneChat(uid: string, chatId: string): Promise<void> {
  // Step 1: delete all messages in batches of 400 (Firestore max is 500)
  const msgsRef = collection(db(), "users", uid, "chats", chatId, "messages");
  let keepGoing = true;
  while (keepGoing) {
    const snap = await getDocs(query(msgsRef, limit(400)));
    if (snap.empty) {
      keepGoing = false;
      break;
    }
    const batch = writeBatch(db());
    snap.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  // Step 2: delete the chat doc itself
  await deleteDoc(doc(db(), "users", uid, "chats", chatId));
}

/**
 * Delete ALL chats and their messages for a user.
 */
export async function deleteAllChats(uid: string): Promise<void> {
  const chatsRef = collection(db(), "users", uid, "chats");
  let keepGoing = true;
  while (keepGoing) {
    const snap = await getDocs(query(chatsRef, limit(50)));
    if (snap.empty) {
      keepGoing = false;
      break;
    }
    for (const chatDoc of snap.docs) {
      await deleteOneChat(uid, chatDoc.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Check if a chat document exists
// ---------------------------------------------------------------------------
export async function chatExists(uid: string, chatId: string): Promise<boolean> {
  try {
    const chatDocRef = doc(db(), "users", uid, "chats", chatId);
    const snap = await getDoc(chatDocRef);
    return snap.exists();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Settings / Preferences (users/{uid}/settings/preferences)
// ---------------------------------------------------------------------------

export interface CustomStyleItem {
  id: string;
  name: string;
  description: string; // max 300 chars
  createdAt: string;
}

export interface UserPreferences {
  displayName?: string;
  nickname?: string;
  userRole?: string;
  customInstructions?: string;
  responseStyle?: "Default" | "Short and direct" | "Detailed" | "Casual Hinglish" | "Formal";
  language?: "Auto" | "Hindi" | "Hinglish" | "English";
  interfaceLanguage?: "English" | "Hindi" | "Hinglish";
  memoryEnabled?: boolean;
  referencePastChats?: boolean;
  webSearchDefault?: boolean;
  theme?: "light" | "dark" | "auto";
  textSize?: "Small" | "Medium" | "Large";
  density?: "Comfortable" | "Compact";
  reduceMotion?: boolean;
  codeBlockWrap?: "scroll" | "wrap";
  voiceName?: string;
  voiceSpeed?: number;
  voiceLanguage?: string;
  micLanguage?: string;
  enterToSend?: boolean;
  autoScroll?: boolean;
  showStarterPrompts?: boolean;
  notifyInBackground?: boolean;
  notifySound?: boolean;
  defaultTemporaryChat?: boolean;
  breakReminderEnabled?: boolean;
  breakReminderMinutes?: 60 | 90 | 120;
  customStyles?: CustomStyleItem[];
  activeCustomStyleId?: string | null;
  updatedAt?: string;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  memoryEnabled: true,
  referencePastChats: true,
  webSearchDefault: false,
  theme: "auto",
  textSize: "Medium",
  density: "Comfortable",
  reduceMotion: false,
  codeBlockWrap: "scroll",
  responseStyle: "Default",
  language: "Auto",
  interfaceLanguage: "English",
  voiceName: "",
  voiceSpeed: 1.0,
  voiceLanguage: "en-IN",
  micLanguage: "en-IN",
  enterToSend: true,
  autoScroll: true,
  showStarterPrompts: true,
  notifyInBackground: false,
  notifySound: false,
  defaultTemporaryChat: false,
  breakReminderEnabled: false,
  breakReminderMinutes: 60,
  customStyles: [],
  activeCustomStyleId: null,
};

export async function loadUserPreferences(uid: string): Promise<UserPreferences | null> {
  try {
    const prefRef = doc(db(), "users", uid, "settings", "preferences");
    const snap = await getDoc(prefRef);
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      ...DEFAULT_USER_PREFERENCES,
      displayName: data.displayName ?? undefined,
      nickname: data.nickname ?? undefined,
      userRole: data.userRole ?? undefined,
      customInstructions: data.customInstructions ?? undefined,
      responseStyle: data.responseStyle || "Default",
      language: data.language || "Auto",
      interfaceLanguage: data.interfaceLanguage || "English",
      memoryEnabled: data.memoryEnabled ?? true,
      referencePastChats: data.referencePastChats ?? true,
      webSearchDefault: data.webSearchDefault ?? false,
      theme: data.theme || "auto",
      textSize: data.textSize || "Medium",
      density: data.density || "Comfortable",
      reduceMotion: data.reduceMotion ?? false,
      codeBlockWrap: data.codeBlockWrap || "scroll",
      voiceName: data.voiceName ?? "",
      voiceSpeed: typeof data.voiceSpeed === "number" ? data.voiceSpeed : 1.0,
      voiceLanguage: data.voiceLanguage || "en-IN",
      micLanguage: data.micLanguage || "en-IN",
      enterToSend: data.enterToSend ?? true,
      autoScroll: data.autoScroll ?? true,
      showStarterPrompts: data.showStarterPrompts ?? true,
      notifyInBackground: data.notifyInBackground ?? false,
      notifySound: data.notifySound ?? false,
      defaultTemporaryChat: data.defaultTemporaryChat ?? false,
      breakReminderEnabled: data.breakReminderEnabled ?? false,
      breakReminderMinutes:
        data.breakReminderMinutes === 90 || data.breakReminderMinutes === 120
          ? data.breakReminderMinutes
          : 60,
      customStyles: Array.isArray(data.customStyles) ? data.customStyles.slice(0, 3) : [],
      activeCustomStyleId: data.activeCustomStyleId ?? null,
      updatedAt: tsToISO(data.updatedAt),
    };
  } catch (err) {
    console.warn("[AUTONEXIS DB] Failed to load user preferences:", err);
    return null;
  }
}

export async function saveUserPreferences(
  uid: string,
  prefs: Partial<UserPreferences>
): Promise<void> {
  const prefRef = doc(db(), "users", uid, "settings", "preferences");
  const cleanPayload: Record<string, any> = { updatedAt: serverTimestamp() };
  Object.entries(prefs).forEach(([k, v]) => {
    if (v !== undefined) {
      cleanPayload[k] = v;
    }
  });
  await setDoc(prefRef, cleanPayload, { merge: true });
}

// ---------------------------------------------------------------------------
// Memory Store (users/{uid}/memories/{id})
// ---------------------------------------------------------------------------

export interface FirestoreMemoryItem {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export async function loadUserMemories(uid: string): Promise<FirestoreMemoryItem[]> {
  try {
    const memRef = collection(db(), "users", uid, "memories");
    const q = query(memRef, orderBy("createdAt", "desc"), limit(100));
    const snap = await getDocs(q);
    const list: FirestoreMemoryItem[] = [];
    snap.forEach((d) => {
      const data = d.data();
      list.push({
        id: d.id,
        text: data.text || "",
        createdAt: tsToISO(data.createdAt),
        updatedAt: tsToISO(data.updatedAt),
      });
    });
    return list;
  } catch (err) {
    console.warn("[AUTONEXIS DB] Failed to load user memories:", err);
    return [];
  }
}

export async function saveUserMemory(
  uid: string,
  text: string,
  id?: string
): Promise<FirestoreMemoryItem> {
  const memId = id || "mem_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
  const memDocRef = doc(db(), "users", uid, "memories", memId);
  const cleanText = text.trim().slice(0, 200);

  await setDoc(
    memDocRef,
    {
      text: cleanText,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );

  return {
    id: memId,
    text: cleanText,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function deleteUserMemory(uid: string, memoryId: string): Promise<void> {
  await deleteDoc(doc(db(), "users", uid, "memories", memoryId));
}

export async function deleteAllUserMemories(uid: string): Promise<void> {
  const memRef = collection(db(), "users", uid, "memories");
  let keepGoing = true;
  while (keepGoing) {
    const snap = await getDocs(query(memRef, limit(200)));
    if (snap.empty) {
      keepGoing = false;
      break;
    }
    const batch = writeBatch(db());
    snap.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

// ---------------------------------------------------------------------------
// Export All User Chats (Full JSON Download)
// ---------------------------------------------------------------------------

export interface ExportedChatData {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: FirestoreMessage[];
}

export async function exportAllUserChats(uid: string): Promise<{
  exportDate: string;
  account: string;
  chats: ExportedChatData[];
}> {
  const result = await loadChatList(uid, 500);
  const exportedChats: ExportedChatData[] = [];

  for (const meta of result.chats) {
    const msgs = await loadChatMessages(uid, meta.id);
    exportedChats.push({
      id: meta.id,
      title: meta.title,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      messages: msgs,
    });
  }

  return {
    exportDate: new Date().toISOString(),
    account: uid,
    chats: exportedChats,
  };
}

// ---------------------------------------------------------------------------
// Projects Store (users/{uid}/projects/{id} & .../files/{fileId})
// ---------------------------------------------------------------------------

export interface FirestoreProject {
  id: string;
  name: string;
  description: string;
  instructions: string; // max 3000 chars
  createdAt: string;
  updatedAt: string;
}

export interface FirestoreProjectFile {
  id: string;
  name: string;
  size: number;
  type: string;
  content: string; // max 50,000 chars
  createdAt: string;
}

export async function loadProjects(uid: string): Promise<FirestoreProject[]> {
  try {
    const projRef = collection(db(), "users", uid, "projects");
    const q = query(projRef, orderBy("updatedAt", "desc"), limit(50));
    const snap = await getDocs(q);
    const list: FirestoreProject[] = [];
    snap.forEach((d) => {
      const data = d.data();
      list.push({
        id: d.id,
        name: data.name || "Untitled Project",
        description: data.description || "",
        instructions: data.instructions || "",
        createdAt: tsToISO(data.createdAt),
        updatedAt: tsToISO(data.updatedAt),
      });
    });
    return list;
  } catch (err) {
    console.warn("[AUTONEXIS DB] Failed to load projects:", err);
    return [];
  }
}

export async function saveProject(
  uid: string,
  proj: { id?: string; name: string; description: string; instructions: string }
): Promise<FirestoreProject> {
  const projId = proj.id || "proj_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6);
  const projRef = doc(db(), "users", uid, "projects", projId);
  const cleanName = proj.name.trim().slice(0, 120) || "Untitled Project";
  const cleanDesc = proj.description.trim().slice(0, 500);
  const cleanInstr = proj.instructions.trim().slice(0, 3000);

  await setDoc(
    projRef,
    {
      name: cleanName,
      description: cleanDesc,
      instructions: cleanInstr,
      updatedAt: serverTimestamp(),
      ...(proj.id ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true }
  );

  const nowIso = new Date().toISOString();
  return {
    id: projId,
    name: cleanName,
    description: cleanDesc,
    instructions: cleanInstr,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export async function loadProjectFiles(uid: string, projectId: string): Promise<FirestoreProjectFile[]> {
  try {
    const filesRef = collection(db(), "users", uid, "projects", projectId, "files");
    const q = query(filesRef, orderBy("createdAt", "asc"), limit(10));
    const snap = await getDocs(q);
    const list: FirestoreProjectFile[] = [];
    snap.forEach((d) => {
      const data = d.data();
      list.push({
        id: d.id,
        name: data.name || "file.txt",
        size: typeof data.size === "number" ? data.size : 0,
        type: data.type || "text/plain",
        content: data.content || "",
        createdAt: tsToISO(data.createdAt),
      });
    });
    return list;
  } catch (err) {
    console.warn("[AUTONEXIS DB] Failed to load project files:", err);
    return [];
  }
}

export async function saveProjectFile(
  uid: string,
  projectId: string,
  file: { id?: string; name: string; size: number; type: string; content: string }
): Promise<FirestoreProjectFile> {
  const fileId = file.id || "pfile_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6);
  const fileRef = doc(db(), "users", uid, "projects", projectId, "files", fileId);
  const cappedContent = (file.content || "").slice(0, 50000);

  await setDoc(
    fileRef,
    {
      name: file.name.slice(0, 180),
      size: file.size || cappedContent.length,
      type: file.type || "text/plain",
      content: cappedContent,
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );

  // Touch project updatedAt
  await setDoc(
    doc(db(), "users", uid, "projects", projectId),
    { updatedAt: serverTimestamp() },
    { merge: true }
  );

  return {
    id: fileId,
    name: file.name.slice(0, 180),
    size: file.size || cappedContent.length,
    type: file.type || "text/plain",
    content: cappedContent,
    createdAt: new Date().toISOString(),
  };
}

export async function deleteProjectFile(uid: string, projectId: string, fileId: string): Promise<void> {
  await deleteDoc(doc(db(), "users", uid, "projects", projectId, "files", fileId));
  await setDoc(
    doc(db(), "users", uid, "projects", projectId),
    { updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function deleteProjectAndUnlinkChats(
  uid: string,
  projectId: string,
  knownChatIds: string[] = []
): Promise<void> {
  // 1. Delete all files inside the project
  const filesRef = collection(db(), "users", uid, "projects", projectId, "files");
  const filesSnap = await getDocs(query(filesRef, limit(50)));
  if (!filesSnap.empty) {
    const batch = writeBatch(db());
    filesSnap.forEach((f) => batch.delete(f.ref));
    await batch.commit();
  }

  // 2. Delete project document
  await deleteDoc(doc(db(), "users", uid, "projects", projectId));

  // 3. Move all chats belonging to this project out of the project (keep chats intact!)
  const linkedIds = new Set<string>(knownChatIds);
  try {
    const qChats = query(
      collection(db(), "users", uid, "chats"),
      where("projectId", "==", projectId)
    );
    const snapChats = await getDocs(qChats);
    snapChats.forEach((c) => linkedIds.add(c.id));
  } catch (err) {
    console.warn("[AUTONEXIS DB] Query linked chats fallback:", err);
  }

  if (linkedIds.size > 0) {
    const batch = writeBatch(db());
    linkedIds.forEach((cid) => {
      batch.set(
        doc(db(), "users", uid, "chats", cid),
        { projectId: null, updatedAt: serverTimestamp() },
        { merge: true }
      );
    });
    await batch.commit();
  }
}

// ---------------------------------------------------------------------------
// Feedback Store (users/{uid}/feedback/{id})
// ---------------------------------------------------------------------------

export interface FirestoreFeedback {
  id: string;
  chatId: string;
  messageId: string;
  rating: "up" | "down";
  reason?: string;
  comment?: string;
  createdAt: string;
}

export async function saveMessageFeedback(
  uid: string,
  feedback: {
    chatId: string;
    messageId: string;
    rating: "up" | "down";
    reason?: string;
    comment?: string;
  }
): Promise<FirestoreFeedback> {
  const feedbackId = `${feedback.chatId}_${feedback.messageId}`;
  const fbRef = doc(db(), "users", uid, "feedback", feedbackId);
  const payload: Record<string, any> = {
    chatId: feedback.chatId,
    messageId: feedback.messageId,
    rating: feedback.rating,
    createdAt: serverTimestamp(),
  };
  if (feedback.reason) payload.reason = feedback.reason.slice(0, 120);
  if (feedback.comment) payload.comment = feedback.comment.trim().slice(0, 600);

  await setDoc(fbRef, payload, { merge: true });

  return {
    id: feedbackId,
    chatId: feedback.chatId,
    messageId: feedback.messageId,
    rating: feedback.rating,
    reason: payload.reason,
    comment: payload.comment,
    createdAt: new Date().toISOString(),
  };
}

export async function loadChatFeedback(
  uid: string,
  chatId: string
): Promise<Record<string, FirestoreFeedback>> {
  try {
    const q = query(
      collection(db(), "users", uid, "feedback"),
      where("chatId", "==", chatId),
      limit(100)
    );
    const snap = await getDocs(q);
    const result: Record<string, FirestoreFeedback> = {};
    snap.forEach((d) => {
      const data = d.data();
      if (data.messageId) {
        result[data.messageId] = {
          id: d.id,
          chatId: data.chatId,
          messageId: data.messageId,
          rating: data.rating === "down" ? "down" : "up",
          reason: data.reason,
          comment: data.comment,
          createdAt: tsToISO(data.createdAt),
        };
      }
    });
    return result;
  } catch (err) {
    console.warn("[AUTONEXIS DB] Failed to load chat feedback:", err);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Problem Reports Store (users/{uid}/reports/{id})
// ---------------------------------------------------------------------------

export interface ProblemReportPayload {
  category: string;
  message: string;
  appVersion: string;
  browser: string;
}

export async function saveProblemReport(
  uid: string,
  report: ProblemReportPayload
): Promise<string> {
  const reportId = "rep_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6);
  const reportRef = doc(db(), "users", uid, "reports", reportId);
  await setDoc(reportRef, {
    category: report.category.slice(0, 60),
    message: report.message.trim().slice(0, 2000),
    appVersion: report.appVersion.slice(0, 40),
    browser: report.browser.slice(0, 250),
    createdAt: serverTimestamp(),
  });
  return reportId;
}



