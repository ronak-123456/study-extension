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

// --- Google Sign-In via chrome.identity ---

function signInWithGoogle() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, async (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(chrome.runtime.lastError || new Error("No token returned"));
        return;
      }
      try {
        const credential = firebase.GoogleAuthProvider.credential(null, token);
        const auth = getFirebaseAuth();
        const result = await firebase.signInWithCredential(auth, credential);
        resolve(result.user);
      } catch (err) {
        // If token is stale, revoke and retry once
        if (err.code === 'auth/invalid-credential') {
          chrome.identity.removeCachedAuthToken({ token }, () => {
            chrome.identity.getAuthToken({ interactive: true }, async (newToken) => {
              if (chrome.runtime.lastError || !newToken) {
                reject(chrome.runtime.lastError || new Error("No token on retry"));
                return;
              }
              try {
                const cred = firebase.GoogleAuthProvider.credential(null, newToken);
                const result = await firebase.signInWithCredential(auth, cred);
                resolve(result.user);
              } catch (retryErr) {
                reject(retryErr);
              }
            });
          });
        } else {
          reject(err);
        }
      }
    });
  });
}

function signOutUser() {
  return new Promise((resolve, reject) => {
    const auth = getFirebaseAuth();
    firebase.signOut(auth).then(() => {
      // Also revoke the Chrome identity token
      chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if (token) {
          chrome.identity.removeCachedAuthToken({ token }, () => {
            resolve();
          });
        } else {
          resolve();
        }
      });
    }).catch(reject);
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
