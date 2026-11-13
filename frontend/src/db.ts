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
  getDocsFromServer,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
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
// Delete Tombstones & ?debug=1 Storage/Retention Trace (paths only, zero content)
// ---------------------------------------------------------------------------

const _DELETING_CHATS = new Set<string>();
const _DELETED_CHAT_TOMBSTONES = new Set<string>();
const _STORAGE_DEBUG_TRACE: Array<{ ts: string; op: string; path: string }> = [];

function chatKey(uid: string, chatId: string): string {
  return `${uid}:${chatId}`;
}

export function markChatDeleting(uid: string, chatId: string): void {
  const k = chatKey(uid, chatId);
  _DELETING_CHATS.add(k);
  _DELETED_CHAT_TOMBSTONES.add(k);
}

export function clearChatDeletingFlag(uid: string, chatId: string, deletedSucceeded: boolean): void {
  const k = chatKey(uid, chatId);
  _DELETING_CHATS.delete(k);
  if (!deletedSucceeded) {
    _DELETED_CHAT_TOMBSTONES.delete(k);
  }
}

export function isChatDeletingOrDeleted(uid: string, chatId: string): boolean {
  const k = chatKey(uid, chatId);
  return _DELETING_CHATS.has(k) || _DELETED_CHAT_TOMBSTONES.has(k);
}

export function clearAllDeleteTombstones(): void {
  _DELETING_CHATS.clear();
  _DELETED_CHAT_TOMBSTONES.clear();
}

export function recordStorageDebugTrace(op: string, path: string): void {
  const entry = {
    ts: new Date().toISOString().slice(11, 23),
    op,
    path,
  };
  _STORAGE_DEBUG_TRACE.push(entry);
  if (_STORAGE_DEBUG_TRACE.length > 60) {
    _STORAGE_DEBUG_TRACE.splice(0, _STORAGE_DEBUG_TRACE.length - 60);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("autonexis:storage-trace", { detail: entry }));
  }
}

export function getStorageDebugTraces(): Array<{ ts: string; op: string; path: string }> {
  return [..._STORAGE_DEBUG_TRACE];
}

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
  mediaType?: "text" | "image" | "video" | "voice";
  originalRequest?: string;
  finalPrompt?: string;
  style?: string;
  aspect?: string;
  width?: number;
  height?: number;
  seed?: number;
  model?: string;
  status?: "generating" | "ready" | "expired" | "deleted" | "error" | "blocked";
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
      mediaType: data.mediaType || undefined,
      originalRequest: data.originalRequest || undefined,
      finalPrompt: data.finalPrompt || undefined,
      style: data.style || undefined,
      aspect: data.aspect || undefined,
      width: typeof data.width === "number" ? data.width : undefined,
      height: typeof data.height === "number" ? data.height : undefined,
      seed: typeof data.seed === "number" ? data.seed : undefined,
      model: data.model || undefined,
      status: data.status || undefined,
    });
  });
  return messages;
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/**
 * Save or update a chat document and its new messages in a single batch.
 * Never writes if chat is marked deleting/deleted, and uses update() when
 * updating an existing chat so a late save can never resurrect a deleted chat.
 */
export async function saveChatWithMessages(
  uid: string,
  chatId: string,
  title: string,
  newMessages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    mediaType?: "text" | "image" | "video" | "voice";
    originalRequest?: string;
    finalPrompt?: string;
    style?: string;
    aspect?: string;
    width?: number;
    height?: number;
    seed?: number;
    model?: string;
    status?: "generating" | "ready" | "expired" | "deleted" | "error" | "blocked";
  }>,
  extraMeta?: { projectId?: string | null; pinned?: boolean; archived?: boolean; isExistingChat?: boolean }
): Promise<void> {
  if (isChatDeletingOrDeleted(uid, chatId)) {
    recordStorageDebugTrace("skip_save_deleted", `users/${uid}/chats/${chatId}`);
    return;
  }

  const chatDocRef = doc(db(), "users", uid, "chats", chatId);
  const isExisting = !!extraMeta?.isExistingChat;

  if (isExisting) {
    // Verify server existence so deleted chats cannot be silently recreated by late saves
    const serverChat = await getDocFromServer(chatDocRef).catch(() => null);
    if (!serverChat || !serverChat.exists() || isChatDeletingOrDeleted(uid, chatId)) {
      recordStorageDebugTrace("skip_late_save_missing_chat", `users/${uid}/chats/${chatId}`);
      return;
    }
  }

  const batch = writeBatch(db());

  if (isExisting) {
    const updateMeta: Record<string, any> = {
      updatedAt: serverTimestamp(),
    };
    if (title) updateMeta.title = title;
    if (extraMeta) {
      if (extraMeta.projectId !== undefined) updateMeta.projectId = extraMeta.projectId;
      if (extraMeta.pinned !== undefined) updateMeta.pinned = extraMeta.pinned;
      if (extraMeta.archived !== undefined) updateMeta.archived = extraMeta.archived;
    }
    batch.update(chatDocRef, updateMeta);
  } else {
    const metaUpdate: Record<string, any> = {
      title,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    };
    if (extraMeta) {
      if (extraMeta.projectId !== undefined) metaUpdate.projectId = extraMeta.projectId;
      if (extraMeta.pinned !== undefined) metaUpdate.pinned = extraMeta.pinned;
      if (extraMeta.archived !== undefined) metaUpdate.archived = extraMeta.archived;
    }
    batch.set(chatDocRef, metaUpdate, { merge: true });
  }

  // Add messages (never store image base64 directly in message docs)
  for (const msg of newMessages) {
    const msgRef = doc(db(), "users", uid, "chats", chatId, "messages", msg.id);
    const msgDoc: Record<string, any> = {
      role: msg.role,
      content: sanitizeContentForStorage(msg.content),
      createdAt: serverTimestamp(),
    };
    if (msg.mediaType) msgDoc.mediaType = msg.mediaType;
    if (msg.originalRequest) msgDoc.originalRequest = msg.originalRequest.slice(0, 1200);
    if (msg.finalPrompt) msgDoc.finalPrompt = msg.finalPrompt.slice(0, 1200);
    if (msg.style) msgDoc.style = msg.style.slice(0, 48);
    if (msg.aspect) msgDoc.aspect = msg.aspect.slice(0, 16);
    if (typeof msg.width === "number") msgDoc.width = msg.width;
    if (typeof msg.height === "number") msgDoc.height = msg.height;
    if (typeof msg.seed === "number") msgDoc.seed = msg.seed;
    if (msg.model) msgDoc.model = msg.model.slice(0, 32);
    if (msg.status) msgDoc.status = msg.status;
    batch.set(msgRef, msgDoc);
  }

  if (isChatDeletingOrDeleted(uid, chatId)) {
    recordStorageDebugTrace("abort_commit_deleting", `users/${uid}/chats/${chatId}`);
    return;
  }

  await batch.commit();
}

/**
 * Update pin, archive, or project assignment flags on an existing chat document.
 */
export async function updateChatFlags(
  uid: string,
  chatId: string,
  flags: { pinned?: boolean; archived?: boolean; projectId?: string | null }
): Promise<void> {
  if (isChatDeletingOrDeleted(uid, chatId)) return;
  const chatDocRef = doc(db(), "users", uid, "chats", chatId);
  const payload: Record<string, any> = { updatedAt: serverTimestamp() };
  if (flags.pinned !== undefined) payload.pinned = flags.pinned;
  if (flags.archived !== undefined) payload.archived = flags.archived;
  if (flags.projectId !== undefined) payload.projectId = flags.projectId;
  await updateDoc(chatDocRef, payload);
}

/**
 * Edit the user's message and delete any messages (plus any image assets) after it.
 */
export async function replaceMessageAndDeleteAfter(
  uid: string,
  chatId: string,
  editedMsgId: string,
  newContent: string,
  deleteMsgIds: string[]
): Promise<void> {
  if (isChatDeletingOrDeleted(uid, chatId)) return;
  const chatDocRef = doc(db(), "users", uid, "chats", chatId);
  const editedRef = doc(db(), "users", uid, "chats", chatId, "messages", editedMsgId);

  for (const delId of deleteMsgIds) {
    await deleteMessageAssetsForMessage(uid, chatId, delId).catch(() => {});
  }

  const batch = writeBatch(db());
  batch.update(editedRef, { content: sanitizeContentForStorage(newContent) });

  for (const delId of deleteMsgIds) {
    const delRef = doc(db(), "users", uid, "chats", chatId, "messages", delId);
    batch.delete(delRef);
  }

  batch.update(chatDocRef, { updatedAt: serverTimestamp() });
  await batch.commit();
}

/**
 * Update only the chat title (updateDoc prevents resurrecting deleted chats).
 */
export async function updateChatTitle(
  uid: string,
  chatId: string,
  title: string
): Promise<void> {
  if (isChatDeletingOrDeleted(uid, chatId)) return;
  const chatDocRef = doc(db(), "users", uid, "chats", chatId);
  await updateDoc(chatDocRef, { title, updatedAt: serverTimestamp() });
}

/**
 * Update only the updatedAt timestamp on an existing chat.
 */
export async function touchChat(uid: string, chatId: string): Promise<void> {
  if (isChatDeletingOrDeleted(uid, chatId)) return;
  const chatDocRef = doc(db(), "users", uid, "chats", chatId);
  await updateDoc(chatDocRef, { updatedAt: serverTimestamp() });
}

// ---------------------------------------------------------------------------
// Image Asset Storage & Retention (Latest 20 stored images per user)
// ---------------------------------------------------------------------------

export const MAX_STORED_IMAGES_PER_USER = 20;

async function deleteMessageAssetsForMessage(uid: string, chatId: string, msgId: string): Promise<number> {
  let removed = 0;
  const assetsCol = collection(db(), "users", uid, "chats", chatId, "messages", msgId, "assets");
  const snap = await getDocsFromServer(query(assetsCol, limit(50))).catch(() => getDocs(query(assetsCol, limit(50))));
  if (!snap.empty) {
    const batch = writeBatch(db());
    snap.forEach((d) => {
      batch.delete(d.ref);
      removed++;
      recordStorageDebugTrace("delete_asset", d.ref.path);
    });
    await batch.commit();
  }
  const indexRef = doc(db(), "users", uid, "imageAssets", msgId);
  await deleteDoc(indexRef).catch(() => {});
  return removed;
}

/**
 * Save compressed JPEG base64 (~<=150 KB) into dedicated asset subcollection
 * users/{uid}/chats/{chatId}/messages/{msgId}/assets/main and enforce 20-image retention.
 */
export async function saveMessageImageAsset(
  uid: string,
  chatId: string,
  msgId: string,
  asset: { dataUrl: string; width: number; height: number; sizeBytes: number }
): Promise<{ evictedCount: number }> {
  if (isChatDeletingOrDeleted(uid, chatId)) {
    recordStorageDebugTrace("skip_asset_save_deleting", `users/${uid}/chats/${chatId}/messages/${msgId}/assets/main`);
    return { evictedCount: 0 };
  }

  const chatDocRef = doc(db(), "users", uid, "chats", chatId);
  const serverChat = await getDocFromServer(chatDocRef).catch(() => null);
  if (!serverChat || !serverChat.exists() || isChatDeletingOrDeleted(uid, chatId)) {
    recordStorageDebugTrace("skip_asset_missing_chat", `users/${uid}/chats/${chatId}/messages/${msgId}/assets/main`);
    return { evictedCount: 0 };
  }

  const assetRef = doc(db(), "users", uid, "chats", chatId, "messages", msgId, "assets", "main");
  await setDoc(assetRef, {
    dataUrl: asset.dataUrl,
    mime: "image/jpeg",
    width: asset.width,
    height: asset.height,
    sizeBytes: asset.sizeBytes,
    chatId,
    messageId: msgId,
    createdAt: serverTimestamp(),
  });
  recordStorageDebugTrace("save_asset", assetRef.path);

  const indexRef = doc(db(), "users", uid, "imageAssets", msgId);
  await setDoc(indexRef, {
    chatId,
    messageId: msgId,
    assetPath: assetRef.path,
    sizeBytes: asset.sizeBytes,
    createdAt: serverTimestamp(),
  });

  const evictedCount = await enforceImageRetention(uid, MAX_STORED_IMAGES_PER_USER);
  return { evictedCount };
}

/**
 * Load compressed JPEG Data URL lazily from users/{uid}/chats/{chatId}/messages/{msgId}/assets/main.
 */
export async function loadMessageImageAsset(
  uid: string,
  chatId: string,
  msgId: string
): Promise<string | null> {
  try {
    const assetRef = doc(db(), "users", uid, "chats", chatId, "messages", msgId, "assets", "main");
    const snap = await getDoc(assetRef);
    if (!snap.exists()) return null;
    const data = snap.data();
    return typeof data.dataUrl === "string" && data.dataUrl.startsWith("data:image/") ? data.dataUrl : null;
  } catch (err) {
    console.warn("[AUTONEXIS DB] Lazy image asset read error:", err);
    return null;
  }
}

/**
 * Deletes ONLY the stored image asset for one message (leaving parameters & Regenerate button).
 */
export async function deleteMessageImageAsset(
  uid: string,
  chatId: string,
  msgId: string
): Promise<void> {
  if (isChatDeletingOrDeleted(uid, chatId)) return;
  await deleteMessageAssetsForMessage(uid, chatId, msgId);
  const msgRef = doc(db(), "users", uid, "chats", chatId, "messages", msgId);
  await updateDoc(msgRef, { status: "deleted" }).catch(() => {});
  recordStorageDebugTrace("mark_image_deleted", msgRef.path);
}

/**
 * Keep at most `keepLimit` newest stored images per user.
 * Deletes ONLY oldest assets beyond the limit; preserves message text & parameters.
 */
export async function enforceImageRetention(uid: string, keepLimit = MAX_STORED_IMAGES_PER_USER): Promise<number> {
  try {
    const idxCol = collection(db(), "users", uid, "imageAssets");
    const snap = await getDocsFromServer(query(idxCol, orderBy("createdAt", "desc"), limit(200))).catch(() =>
      getDocs(query(idxCol, orderBy("createdAt", "desc"), limit(200)))
    );
    if (snap.size <= keepLimit) return 0;

    const toEvict = snap.docs.slice(keepLimit);
    let evicted = 0;
    for (const d of toEvict) {
      const data = d.data();
      const chatId = String(data.chatId || "");
      const msgId = String(data.messageId || d.id);
      if (!chatId || !msgId || isChatDeletingOrDeleted(uid, chatId)) continue;

      const assetRef = doc(db(), "users", uid, "chats", chatId, "messages", msgId, "assets", "main");
      await deleteDoc(assetRef).catch(() => {});
      recordStorageDebugTrace("retention_evict_asset", assetRef.path);

      const msgRef = doc(db(), "users", uid, "chats", chatId, "messages", msgId);
      await updateDoc(msgRef, { status: "expired" }).catch(() => {});
      await deleteDoc(d.ref).catch(() => {});
      evicted++;
    }
    return evicted;
  } catch (err) {
    console.warn("[AUTONEXIS DB] Image retention pass skipped:", err);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Robust Delete operations (Single chat, Delete all chats, Orphan cleanup)
// ---------------------------------------------------------------------------

/**
 * Robustly delete one chat and ALL its subcollections:
 *   1) All image asset docs inside messages/{id}/assets/* and imageAssets index docs
 *   2) All messages in batches of <= 400 in a loop until empty
 *   3) Feedback docs linked to chatId in batches of <= 400
 *   4) Chat doc users/{uid}/chats/{chatId}
 *   5) Verify from SERVER (getDocFromServer / getDocsFromServer) that nothing remains
 */
export async function deleteChat(uid: string, chatId: string): Promise<void> {
  markChatDeleting(uid, chatId);
  const chatDocRef = doc(db(), "users", uid, "chats", chatId);
  const msgsRef = collection(db(), "users", uid, "chats", chatId, "messages");

  try {
    // 1 & 2. Loop through all messages and delete their assets + message docs in <=400 op batches
    let keepGoing = true;
    while (keepGoing) {
      const snap = await getDocsFromServer(query(msgsRef, limit(400)));
      if (snap.empty) {
        keepGoing = false;
        break;
      }

      // First delete any image asset docs & index entries for this slice of messages
      const deleteRefs: any[] = [];
      for (const msgDoc of snap.docs) {
        const assetsCol = collection(db(), "users", uid, "chats", chatId, "messages", msgDoc.id, "assets");
        const assetSnap = await getDocsFromServer(query(assetsCol, limit(50))).catch(() =>
          getDocs(query(assetsCol, limit(50)))
        );
        assetSnap.forEach((a) => {
          deleteRefs.push(a.ref);
          recordStorageDebugTrace("delete_asset", a.ref.path);
        });
        deleteRefs.push(doc(db(), "users", uid, "imageAssets", msgDoc.id));
        deleteRefs.push(msgDoc.ref);
        recordStorageDebugTrace("delete_message", msgDoc.ref.path);
      }

      // Commit deletions strictly in chunks <= 400
      for (let i = 0; i < deleteRefs.length; i += 400) {
        const batch = writeBatch(db());
        const chunk = deleteRefs.slice(i, i + 400);
        chunk.forEach((r) => batch.delete(r));
        await batch.commit();
      }
    }

    // 3. Delete any feedback records tied to this chatId
    try {
      const fbCol = collection(db(), "users", uid, "feedback");
      const fbSnap = await getDocsFromServer(query(fbCol, where("chatId", "==", chatId), limit(400)));
      if (!fbSnap.empty) {
        const fbBatch = writeBatch(db());
        fbSnap.forEach((f) => {
          fbBatch.delete(f.ref);
          recordStorageDebugTrace("delete_feedback", f.ref.path);
        });
        await fbBatch.commit();
      }
    } catch {
      // Non-fatal feedback cleanup error
    }

    // 4. Delete in-chat memory state document
    try {
      const memoryDocRef = doc(db(), "users", uid, "chats", chatId, "state", "memory");
      await deleteDoc(memoryDocRef).catch(() => {});
      recordStorageDebugTrace("delete_chat_memory", memoryDocRef.path);
    } catch {
      // Non-fatal memory cleanup error
    }

    // 5. Delete the chat document itself
    await deleteDoc(chatDocRef);
    recordStorageDebugTrace("delete_chat", chatDocRef.path);

    // 5. Verify directly from SERVER (never cache) that nothing remains
    const verifyChat = await getDocFromServer(chatDocRef);
    if (verifyChat.exists()) {
      throw new Error(`Chat ${chatId} still exists on server after deletion.`);
    }
    const verifyMsgs = await getDocsFromServer(query(msgsRef, limit(1)));
    if (!verifyMsgs.empty) {
      throw new Error(`Leftover messages found on server for chat ${chatId}.`);
    }

    clearChatDeletingFlag(uid, chatId, true);
  } catch (err) {
    clearChatDeletingFlag(uid, chatId, false);
    throw err;
  }
}

/** Backwards-compatible export alias */
export const deleteOneChat = deleteChat;

/**
 * Delete ALL chats and their nested messages/image assets using deleteChat.
 */
export async function deleteAllChats(uid: string): Promise<void> {
  const chatsRef = collection(db(), "users", uid, "chats");
  let keepGoing = true;
  while (keepGoing) {
    const snap = await getDocsFromServer(query(chatsRef, limit(50)));
    if (snap.empty) {
      keepGoing = false;
      break;
    }
    for (const chatDoc of snap.docs) {
      await deleteChat(uid, chatDoc.id);
    }
  }
}

/**
 * Settings "Clean up storage": finds and removes orphaned image assets,
 * leftover messages in deleted chats, and dangling index/feedback items
 * strictly under the signed-in user's namespace.
 */
export async function cleanupOrphanedStorage(uid: string): Promise<{ removedCount: number; paths: string[] }> {
  let removedCount = 0;
  const removedPaths: string[] = [];
  const chatExistsCache = new Map<string, boolean>();

  const checkChatExistsOnServer = async (chatId: string): Promise<boolean> => {
    if (chatExistsCache.has(chatId)) return chatExistsCache.get(chatId)!;
    const snap = await getDocFromServer(doc(db(), "users", uid, "chats", chatId));
    const exists = snap.exists();
    chatExistsCache.set(chatId, exists);
    return exists;
  };

  // 1. Inspect users/{uid}/imageAssets for orphans
  const idxCol = collection(db(), "users", uid, "imageAssets");
  const idxSnap = await getDocsFromServer(query(idxCol, limit(500)));
  for (const idxDoc of idxSnap.docs) {
    const data = idxDoc.data();
    const chatId = String(data.chatId || "");
    const msgId = String(data.messageId || idxDoc.id);
    if (!chatId || !msgId) {
      await deleteDoc(idxDoc.ref);
      removedCount++;
      removedPaths.push(idxDoc.ref.path);
      continue;
    }

    const parentChatOk = await checkChatExistsOnServer(chatId);
    if (!parentChatOk) {
      // Delete orphaned assets + messages inside deleted chatId folder
      const deletedAssets = await deleteMessageAssetsForMessage(uid, chatId, msgId);
      removedCount += deletedAssets;
      const msgRef = doc(db(), "users", uid, "chats", chatId, "messages", msgId);
      const msgSnap = await getDocFromServer(msgRef).catch(() => null);
      if (msgSnap?.exists()) {
        await deleteDoc(msgRef);
        removedCount++;
        removedPaths.push(msgRef.path);
        recordStorageDebugTrace("cleanup_orphan_msg", msgRef.path);
      }
      await deleteDoc(idxDoc.ref).catch(() => {});
      removedCount++;
      removedPaths.push(idxDoc.ref.path);
      recordStorageDebugTrace("cleanup_orphan_index", idxDoc.ref.path);
    } else {
      const msgRef = doc(db(), "users", uid, "chats", chatId, "messages", msgId);
      const msgSnap = await getDocFromServer(msgRef).catch(() => null);
      if (!msgSnap?.exists()) {
        const deletedAssets = await deleteMessageAssetsForMessage(uid, chatId, msgId);
        removedCount += deletedAssets + 1;
        removedPaths.push(idxDoc.ref.path);
        recordStorageDebugTrace("cleanup_orphan_asset_no_msg", idxDoc.ref.path);
      }
    }
  }

  // 2. Inspect feedback docs whose chat no longer exists on server
  const fbCol = collection(db(), "users", uid, "feedback");
  const fbSnap = await getDocsFromServer(query(fbCol, limit(400)));
  const orphanFbRefs: any[] = [];
  for (const fbDoc of fbSnap.docs) {
    const cId = String(fbDoc.data().chatId || "");
    if (!cId) continue;
    if (!(await checkChatExistsOnServer(cId))) {
      orphanFbRefs.push(fbDoc.ref);
    }
  }
  for (let i = 0; i < orphanFbRefs.length; i += 400) {
    const batch = writeBatch(db());
    orphanFbRefs.slice(i, i + 400).forEach((r) => {
      batch.delete(r);
      removedCount++;
      removedPaths.push(r.path);
      recordStorageDebugTrace("cleanup_orphan_feedback", r.path);
    });
    await batch.commit();
  }

  return { removedCount, paths: removedPaths };
}

// ---------------------------------------------------------------------------
// Image Moderation Log Store (users/{uid}/moderation)
// ---------------------------------------------------------------------------

export async function saveModerationLog(
  uid: string,
  entry: { category: string; cooldownTriggered?: boolean }
): Promise<void> {
  const modId = "mod_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6);
  const modRef = doc(db(), "users", uid, "moderation", modId);
  await setDoc(modRef, {
    uid,
    category: entry.category.slice(0, 64),
    cooldownTriggered: !!entry.cooldownTriggered,
    createdAt: serverTimestamp(),
  });
  recordStorageDebugTrace("save_moderation", modRef.path);
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
  voiceCallCaptions?: boolean;
  voiceCallBargeIn?: boolean;
  voiceCallSilenceSec?: 30 | 60 | 90;
  voiceCallEndPauseMs?: 800 | 1000 | 1200;
  voiceCallCloudTts?: boolean;
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
  addDownloadWatermark?: boolean;
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
  voiceCallCaptions: true,
  voiceCallBargeIn: true,
  voiceCallSilenceSec: 60,
  voiceCallEndPauseMs: 1000,
  voiceCallCloudTts: false,
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
  addDownloadWatermark: false,
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
      voiceCallCaptions: data.voiceCallCaptions ?? true,
      voiceCallBargeIn: data.voiceCallBargeIn ?? true,
      voiceCallSilenceSec:
        data.voiceCallSilenceSec === 30 || data.voiceCallSilenceSec === 90
          ? data.voiceCallSilenceSec
          : 60,
      voiceCallEndPauseMs:
        data.voiceCallEndPauseMs === 800 || data.voiceCallEndPauseMs === 1200
          ? data.voiceCallEndPauseMs
          : 1000,
      voiceCallCloudTts: data.voiceCallCloudTts ?? false,
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
      addDownloadWatermark: data.addDownloadWatermark ?? false,
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
      if (!isChatDeletingOrDeleted(uid, cid)) {
        batch.update(doc(db(), "users", uid, "chats", cid), {
          projectId: null,
          updatedAt: serverTimestamp(),
        });
      }
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

export async function saveImageReport(
  uid: string,
  report: {
    chatId: string;
    messageId: string;
    originalRequest?: string;
    finalPrompt?: string;
    style?: string;
    aspect?: string;
    width?: number;
    height?: number;
    seed?: number;
    reason?: string;
  }
): Promise<string> {
  const reportId = "imgrep_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6);
  const reportRef = doc(db(), "users", uid, "reports", reportId);
  await setDoc(reportRef, {
    category: "Generated Image Report",
    chatId: report.chatId.slice(0, 120),
    messageId: report.messageId.slice(0, 120),
    originalRequest: (report.originalRequest || "").slice(0, 1000),
    finalPrompt: (report.finalPrompt || "").slice(0, 1000),
    style: (report.style || "").slice(0, 48),
    aspect: (report.aspect || "").slice(0, 16),
    width: typeof report.width === "number" ? report.width : null,
    height: typeof report.height === "number" ? report.height : null,
    seed: typeof report.seed === "number" ? report.seed : null,
    reason: (report.reason || "User reported generated image").slice(0, 400),
    createdAt: serverTimestamp(),
  });
  return reportId;
}

// ---------------------------------------------------------------------------
// In-Chat Memory State Store (users/{uid}/chats/{chatId}/state/memory)
// ---------------------------------------------------------------------------

export interface ChatMemoryFact {
  id: string;
  text: string;
  type?: "fact" | "decision" | "preference" | "detail";
  sourceMessageId?: string;
  time?: string;
}

export interface ChatMemoryTimelineItem {
  time: string;
  note: string;
}

export interface ChatMemoryState {
  summary: string;
  facts: ChatMemoryFact[];
  openThreads: string[];
  timeline: ChatMemoryTimelineItem[];
  lastSummarizedMessageId?: string;
  version: number;
  updatedAt: string;
}

export async function loadChatMemoryState(
  uid: string,
  chatId: string
): Promise<ChatMemoryState | null> {
  if (!uid || !chatId || isChatDeletingOrDeleted(uid, chatId)) return null;
  try {
    const memoryRef = doc(db(), "users", uid, "chats", chatId, "state", "memory");
    const snap = await getDoc(memoryRef);
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      summary: typeof data.summary === "string" ? data.summary : "",
      facts: Array.isArray(data.facts) ? data.facts : [],
      openThreads: Array.isArray(data.openThreads) ? data.openThreads : [],
      timeline: Array.isArray(data.timeline) ? data.timeline : [],
      lastSummarizedMessageId: typeof data.lastSummarizedMessageId === "string" ? data.lastSummarizedMessageId : undefined,
      version: typeof data.version === "number" ? data.version : 1,
      updatedAt: tsToISO(data.updatedAt),
    };
  } catch (err) {
    console.warn("[AUTONEXIS DB] Failed loading chat memory state:", err);
    return null;
  }
}

export async function saveChatMemoryState(
  uid: string,
  chatId: string,
  state: ChatMemoryState
): Promise<void> {
  if (!uid || !chatId || isChatDeletingOrDeleted(uid, chatId)) return;
  const memoryRef = doc(db(), "users", uid, "chats", chatId, "state", "memory");
  await setDoc(memoryRef, {
    summary: (state.summary || "").slice(0, 1500),
    facts: (state.facts || []).slice(0, 60),
    openThreads: (state.openThreads || []).slice(0, 10),
    timeline: (state.timeline || []).slice(0, 45),
    lastSummarizedMessageId: state.lastSummarizedMessageId || null,
    version: (state.version || 0) + 1,
    updatedAt: serverTimestamp(),
  });
  recordStorageDebugTrace("save_chat_memory", memoryRef.path);
}

export async function deleteChatMemoryFact(
  uid: string,
  chatId: string,
  factId: string
): Promise<void> {
  if (!uid || !chatId || !factId || isChatDeletingOrDeleted(uid, chatId)) return;
  const current = await loadChatMemoryState(uid, chatId);
  if (!current) return;
  const filteredFacts = current.facts.filter((f) => f.id !== factId);
  await saveChatMemoryState(uid, chatId, {
    ...current,
    facts: filteredFacts,
  });
}

export async function clearChatMemoryState(
  uid: string,
  chatId: string
): Promise<void> {
  if (!uid || !chatId) return;
  try {
    const memoryRef = doc(db(), "users", uid, "chats", chatId, "state", "memory");
    await deleteDoc(memoryRef).catch(() => {});
    recordStorageDebugTrace("clear_chat_memory", memoryRef.path);
  } catch (err) {
    console.warn("[AUTONEXIS DB] Failed to clear chat memory state:", err);
  }
}



