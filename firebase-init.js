// Firebase JS SDK v10, loaded as ES modules straight from Google's CDN — no build step, no npm needed for the frontend.
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, signInWithCustomToken
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getDatabase, ref, set, get, update, push, remove, onValue, off, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js";

// Your project config, exactly as given by the Firebase console.
// The apiKey here is NOT a secret — it's meant to be public in client code.
// Everything that actually needs protecting is enforced by database.rules.json.
const firebaseConfig = {
  apiKey: "AIzaSyBRRvh0lKgLoT0oTu7AA98qFoAHkyiMpZ8",
  authDomain: "asdasd-a5b98.firebaseapp.com",
  databaseURL: "https://asdasd-a5b98-default-rtdb.firebaseio.com",
  projectId: "asdasd-a5b98",
  storageBucket: "asdasd-a5b98.firebasestorage.app",
  messagingSenderId: "935370065057",
  appId: "1:935370065057:web:3f30f2ac6d629762d45ce0",
  measurementId: "G-X9YM58NDF1",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

// A second, isolated Firebase app instance used ONLY to create sub-user accounts.
// Without this, calling createUserWithEmailAndPassword would sign the OWNER out
// and sign them in as the new sub-user instead. Using a second app avoids that.
const secondaryApp = initializeApp(firebaseConfig, "Secondary");
export const secondaryAuth = getAuth(secondaryApp);

export {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  ref, set, get, update, push, remove, onValue, off, serverTimestamp,
};

// Usernames aren't emails, but Firebase Auth needs an email-shaped identifier.
// We deterministically build one from the username so login only ever needs
// a username + password, same as before.
export function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@mcpanel.local`;
}
