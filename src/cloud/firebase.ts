import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
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
