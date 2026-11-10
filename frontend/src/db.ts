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

/** Strip base64 data URLs from content to keep docs well under 1 MB */
function sanitizeContentForStorage(content: string): string {
  // Replace data:image/…;base64,… with "[image]"
  return content.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, "[image]");
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
  newMessages: Array<{ id: string; role: "user" | "assistant"; content: string }>
): Promise<void> {
  const batch = writeBatch(db());
  const chatDocRef = doc(db(), "users", uid, "chats", chatId);

  // Upsert chat metadata
  batch.set(
    chatDocRef,
    {
      title,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(), // only takes effect on first create due to merge
    },
    { merge: true }
  );

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

