import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  EmailAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  linkWithCredential,
  updatePassword,
  verifyBeforeUpdateEmail,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc, getFirestore, setDoc } from 'firebase/firestore';
import { migrate, type SaveData } from '../meta/save';

const config: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseConfigured = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);

function services() {
  if (!firebaseConfigured) throw new Error('Firebase 尚未設定');
  const app = getApps().length ? getApp() : initializeApp(config);
  return { auth: getAuth(app), db: getFirestore(app) };
}

export function watchGoogleUser(callback: (user: User | null) => void): () => void {
  if (!firebaseConfigured) return () => undefined;
  return onAuthStateChanged(services().auth, callback);
}

export async function signInGoogle(): Promise<User> {
  const { auth } = services();
  auth.useDeviceLanguage();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return (await signInWithPopup(auth, provider)).user;
}

export async function signOutGoogle(): Promise<void> {
  await signOut(services().auth);
}

// ---------- Email / 密碼 認證 ----------

export async function signInEmail(email: string, password: string): Promise<User> {
  const { auth } = services();
  return (await signInWithEmailAndPassword(auth, email.trim(), password)).user;
}

export async function signUpEmail(email: string, password: string): Promise<User> {
  const { auth } = services();
  return (await createUserWithEmailAndPassword(auth, email.trim(), password)).user;
}

/**
 * 把 Email/密碼連結到目前已登入的帳號（例如已用 Google 登入者加設密碼登入方式）。
 * 若尚未登入，退化為直接以 Email 註冊新帳號。
 */
export async function linkEmail(email: string, password: string): Promise<User> {
  const { auth } = services();
  const user = auth.currentUser;
  if (!user) return signUpEmail(email, password);
  const cred = EmailAuthProvider.credential(email.trim(), password);
  return (await linkWithCredential(user, cred)).user;
}

/** 變更 Email：寄驗證信到新信箱，玩家點連結後才生效（Firebase 安全流程） */
export async function changeEmail(newEmail: string): Promise<void> {
  const { auth } = services();
  if (!auth.currentUser) throw new Error('尚未登入');
  await verifyBeforeUpdateEmail(auth.currentUser, newEmail.trim());
}

export async function changePassword(newPassword: string): Promise<void> {
  const { auth } = services();
  if (!auth.currentUser) throw new Error('尚未登入');
  await updatePassword(auth.currentUser, newPassword);
}

export async function loadCloudSave(uid: string): Promise<SaveData | null> {
  const snapshot = await getDoc(doc(services().db, 'users', uid));
  if (!snapshot.exists()) return null;
  return migrate(snapshot.data().save);
}

export async function writeCloudSave(uid: string, save: SaveData): Promise<void> {
  await setDoc(doc(services().db, 'users', uid), {
    save: structuredClone(save),
    updatedAt: Date.now(),
  });
}
