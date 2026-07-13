// Firebase client initialization for Hocus Focus extension
// Requires: lib/firebase-bundle.js and firebase-config.js loaded first

let firebaseApp = null;
let firebaseAuthInstance = null;
let firestoreInstance = null;

// Initialize Firebase app
function initFirebase() {
  if (!firebaseApp) {
    firebaseApp = firebase.initializeApp(firebaseConfig);
  }
  return firebaseApp;
}

// Get Auth instance
function getFirebaseAuth() {
  if (!firebaseAuthInstance) {
    initFirebase();
    firebaseAuthInstance = firebase.getAuth(firebaseApp);
  }
  return firebaseAuthInstance;
}

// Get Firestore instance
function getFirebaseFirestore() {
  if (!firestoreInstance) {
    initFirebase();
    firestoreInstance = firebase.getFirestore(firebaseApp);
  }
  return firestoreInstance;
}

// --- Auth Helpers ---

async function firebaseSignUp(email, password) {
  const auth = getFirebaseAuth();
  const userCredential = await firebase.createUserWithEmailAndPassword(auth, email, password);
  return userCredential.user;
}

async function firebaseSignIn(email, password) {
  const auth = getFirebaseAuth();
  const userCredential = await firebase.signInWithEmailAndPassword(auth, email, password);
  return userCredential.user;
}

async function firebaseSignOut() {
  const auth = getFirebaseAuth();
  await firebase.signOut(auth);
}

function firebaseOnAuthStateChanged(callback) {
  const auth = getFirebaseAuth();
  return firebase.onAuthStateChanged(auth, callback);
}

function firebaseCurrentUser() {
  const auth = getFirebaseAuth();
  return auth.currentUser;
}

// --- Firestore Helpers ---

async function firestoreAdd(collectionName, data) {
  const db = getFirebaseFirestore();
  const ref = firebase.collection(db, collectionName);
  return await firebase.addDoc(ref, data);
}

async function firestoreSet(collectionName, docId, data) {
  const db = getFirebaseFirestore();
  const ref = firebase.doc(db, collectionName, docId);
  return await firebase.setDoc(ref, data, { merge: true });
}

async function firestoreGet(collectionName, docId) {
  const db = getFirebaseFirestore();
  const ref = firebase.doc(db, collectionName, docId);
  const snap = await firebase.getDoc(ref);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function firestoreQuery(collectionName, ...queryConstraints) {
  const db = getFirebaseFirestore();
  const ref = firebase.collection(db, collectionName);
  const q = firebase.query(ref, ...queryConstraints);
  const snapshot = await firebase.getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function firestoreUpdate(collectionName, docId, data) {
  const db = getFirebaseFirestore();
  const ref = firebase.doc(db, collectionName, docId);
  return await firebase.updateDoc(ref, data);
}

async function firestoreDelete(collectionName, docId) {
  const db = getFirebaseFirestore();
  const ref = firebase.doc(db, collectionName, docId);
  return await firebase.deleteDoc(ref);
}

// Initialize on load
initFirebase();
console.log('[Hocus Focus] Firebase initialized successfully');

// --- Google Sign-In via chrome.identity.launchWebAuthFlow ---
// Uses launchWebAuthFlow (supported in BOTH Chrome and Edge) instead of
// getAuthToken (Chrome-only). The OAuth client below MUST belong to the same
// Google Cloud project as the Firebase project (jerry-95215), otherwise
// Firebase rejects the credential with auth/invalid-credential.

// Web application OAuth client ID from the Firebase project (jerry-95215).
// Get it at: Firebase Console -> Authentication -> Sign-in method -> Google
//            -> Web SDK configuration -> "Web client ID"
const GOOGLE_WEB_CLIENT_ID = '109296961407-qq2qpiqg5uhi8ruldrrg0m4e3p4ehnu4.apps.googleusercontent.com';

function signInWithGoogle() {
  return new Promise((resolve, reject) => {
    const redirectUri = chrome.identity.getRedirectURL();
    // This exact value must be registered as an Authorized redirect URI on the Web client:
    console.log('[Hocus Focus] OAuth redirect URI to register:', redirectUri);

    // Google requires a nonce when an id_token is requested via the implicit flow.
    const nonce = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);

    const authParams = new URLSearchParams({
      client_id: GOOGLE_WEB_CLIENT_ID,
      response_type: 'id_token token',
      redirect_uri: redirectUri,
      scope: 'openid email profile',
      nonce: nonce,
      prompt: 'select_account'
    });
    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + authParams.toString();

    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, async (responseUrl) => {
      if (chrome.runtime.lastError || !responseUrl) {
        reject(chrome.runtime.lastError || new Error('Sign-in was cancelled or failed'));
        return;
      }
      try {
        // Google returns tokens in the URL fragment (#id_token=...&access_token=...)
        const fragment = new URL(responseUrl).hash.substring(1);
        const params = new URLSearchParams(fragment);
        const errParam = params.get('error');
        if (errParam) {
          reject(new Error('Google returned error: ' + errParam));
          return;
        }
        const idToken = params.get('id_token');
        const accessToken = params.get('access_token');
        if (!idToken) {
          reject(new Error('No id_token in Google response'));
          return;
        }
        const credential = firebase.GoogleAuthProvider.credential(idToken, accessToken);
        const auth = getFirebaseAuth();
        const result = await firebase.signInWithCredential(auth, credential);
        resolve(result.user);
      } catch (err) {
        reject(err);
      }
    });
  });
}

function signOutUser() {
  return new Promise((resolve, reject) => {
    const auth = getFirebaseAuth();
    firebase.signOut(auth).then(resolve).catch(reject);
  });
}

// --- Cloud Sync (Push/Pull) ---

async function pushToCloud(uid) {
  const allData = await chrome.storage.local.get(null);
  // Don't push internal/temp keys to cloud
  delete allData.backups;
  delete allData.firebase_auth;

  const db = getFirebaseFirestore();
  const ref = firebase.doc(db, 'users', uid);
  await firebase.setDoc(ref, {
    ...allData,
    lastSyncedAt: Date.now()
  }, { merge: true });
  console.log('[Hocus Focus] Data pushed to cloud');
}

async function pullFromCloud(uid) {
  const db = getFirebaseFirestore();
  const ref = firebase.doc(db, 'users', uid);
  const snap = await firebase.getDoc(ref);
  if (snap.exists()) {
    const cloudData = snap.data();
    delete cloudData.lastSyncedAt; // don't overwrite local with sync timestamp
    await chrome.storage.local.set(cloudData);
    console.log('[Hocus Focus] Data pulled from cloud');
    return true;
  }
  return false;
}
