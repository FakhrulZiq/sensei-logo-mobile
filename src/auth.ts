import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { initializeApp, getApps } from 'firebase/app';

// The plugin uses the native Firebase SDK on Android and the JS SDK in the browser.
if (import.meta.env.VITE_FIREBASE_API_KEY && !getApps().length) {
  initializeApp({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  });
}

export async function currentUser() {
  return (await FirebaseAuthentication.getCurrentUser()).user;
}

export async function signIn() {
  return (await FirebaseAuthentication.signInWithGoogle()).user;
}

export async function signOut() {
  await FirebaseAuthentication.signOut();
}

export async function idToken() {
  const result = await FirebaseAuthentication.getIdToken();
  if (!result.token) throw new Error('Sign in again to continue.');
  return result.token;
}

export async function refreshIdToken() {
  await FirebaseAuthentication.getIdToken({ forceRefresh: true });
}
