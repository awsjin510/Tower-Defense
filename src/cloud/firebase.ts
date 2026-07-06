import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  linkWithCredential,
  updatePassword,
  verifyBeforeUpdateEmail,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { migrate, type SaveData } from '../meta/save';

const config: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const apiBase = String(import.meta.env.VITE_CLOUDFLARE_API_URL ?? '').replace(/\/$/, '');
export const firebaseConfigured = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
export const cloudConfigured = firebaseConfigured && Boolean(apiBase);
export const appleLoginEnabled = import.meta.env.VITE_ENABLE_APPLE_LOGIN === 'true';

function authService() {
  if (!firebaseConfigured) throw new Error('Firebase 尚未設定');
  const app = getApps().length ? getApp() : initializeApp(config);
  return getAuth(app);
}

async function apiFetch(user: User, path: string, init?: RequestInit): Promise<Response> {
  if (!apiBase) throw new Error('Cloudflare API 尚未設定');
  const token = await user.getIdToken();
  return fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
}

export function watchGoogleUser(callback: (user: User | null) => void): () => void {
  if (!firebaseConfigured) return () => undefined;
  return onAuthStateChanged(authService(), callback);
}

export async function signInGoogle(): Promise<User> {
  const auth = authService();
  auth.useDeviceLanguage();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return (await signInWithPopup(auth, provider)).user;
}

export async function signInEmail(email: string, password: string): Promise<User> {
  return (await signInWithEmailAndPassword(authService(), email, password)).user;
}

export async function registerEmail(email: string, password: string): Promise<User> {
  return (await createUserWithEmailAndPassword(authService(), email, password)).user;
}

export const signUpEmail = registerEmail;

export async function linkEmail(email: string, password: string): Promise<User> {
  const auth = authService();
  if (!auth.currentUser) return registerEmail(email.trim(), password);
  return (await linkWithCredential(auth.currentUser, EmailAuthProvider.credential(email.trim(), password))).user;
}

export async function changeEmail(newEmail: string): Promise<void> {
  const user = authService().currentUser;
  if (!user) throw new Error('尚未登入');
  await verifyBeforeUpdateEmail(user, newEmail.trim());
}

export async function changePassword(newPassword: string): Promise<void> {
  const user = authService().currentUser;
  if (!user) throw new Error('尚未登入');
  await updatePassword(user, newPassword);
}

export async function resetEmailPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(authService(), email);
}

export async function signInApple(): Promise<User> {
  const auth = authService();
  const provider = new OAuthProvider('apple.com');
  provider.addScope('email');
  provider.addScope('name');
  return (await signInWithPopup(auth, provider)).user;
}

export async function signOutPlayer(): Promise<void> {
  await signOut(authService());
}

export const signOutGoogle = signOutPlayer;

export interface CloudSaveResult {
  save: SaveData | null;
  revision: number;
}

export async function loadCloudSave(user: User): Promise<CloudSaveResult> {
  const response = await apiFetch(user, '/v1/save');
  if (!response.ok) throw new Error(`Cloud save load failed: ${response.status}`);
  const data = (await response.json()) as { save: unknown; revision: number };
  return { save: data.save ? migrate(data.save) : null, revision: data.revision };
}

export async function writeCloudSave(user: User, save: SaveData, revision: number): Promise<number> {
  const response = await apiFetch(user, '/v1/save', {
    method: 'PUT',
    body: JSON.stringify({ save, revision }),
  });
  if (response.status === 409) throw new Error('Cloud save conflict');
  if (!response.ok) throw new Error(`Cloud save write failed: ${response.status}`);
  return ((await response.json()) as { revision: number }).revision;
}

export async function submitRun(
  user: User,
  result: { runId: string; wave: number; kills: number; durationMs: number }
): Promise<void> {
  const response = await apiFetch(user, '/v1/run-result', {
    method: 'POST',
    body: JSON.stringify(result),
  });
  if (!response.ok) throw new Error(`Run submission failed: ${response.status}`);
}

export async function startRun(user: User): Promise<string> {
  const response = await apiFetch(user, '/v1/run/start', { method: 'POST', body: '{}' });
  if (!response.ok) throw new Error(`Run start failed: ${response.status}`);
  return ((await response.json()) as { runId: string }).runId;
}

export interface LeaderboardEntry {
  playerName: string;
  bestWave: number;
  totalRuns: number;
}

/** 取得全球排行榜（無需登入；季賽由後端決定） */
export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  if (!apiBase) throw new Error('Cloudflare API 尚未設定');
  const response = await fetch(`${apiBase}/v1/leaderboard`);
  if (!response.ok) throw new Error(`Leaderboard fetch failed: ${response.status}`);
  return ((await response.json()) as { entries: LeaderboardEntry[] }).entries ?? [];
}
