// Cloud Sync UI Logic — with lazy-loaded Firebase
// Firebase bundle (1.3MB) is NOT loaded on popup open. It's injected only when
// the user interacts with sync features (sign-in, push, pull, or auth check).

let firebaseLoaded = false;
let firebaseLoadPromise = null;

/**
 * Dynamically load Firebase scripts (bundle + config + client).
 * Returns a promise that resolves once all three scripts are loaded and
 * the global Firebase functions (signInWithGoogle, pushToCloud, etc.) are available.
 */
function loadFirebase() {
  if (firebaseLoaded) return Promise.resolve();
  if (firebaseLoadPromise) return firebaseLoadPromise;

  firebaseLoadPromise = new Promise((resolve, reject) => {
    const scripts = [
      '../lib/firebase-bundle.js',
      '../firebase-config.js',
      '../firebase-client.js'
    ];

    let loaded = 0;
    function loadNext() {
      if (loaded >= scripts.length) {
        firebaseLoaded = true;
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = scripts[loaded];
      script.onload = () => {
        loaded++;
        loadNext();
      };
      script.onerror = () => reject(new Error(`Failed to load ${scripts[loaded]}`));
      document.head.appendChild(script);
    }
    loadNext();
  });

  return firebaseLoadPromise;
}

export function initSync() {
  const signInBtn = document.getElementById('signInBtn');
  const signOutBtn = document.getElementById('signOutBtn');
  const pushSyncBtn = document.getElementById('pushSyncBtn');
  const pullSyncBtn = document.getElementById('pullSyncBtn');
  const syncSignedOut = document.getElementById('syncSignedOut');
  const syncSignedIn = document.getElementById('syncSignedIn');
  const syncUserEmail = document.getElementById('syncUserEmail');
  const syncStatus = document.getElementById('syncStatus');

  function showSyncStatus(msg, isError = false) {
    syncStatus.textContent = msg;
    syncStatus.style.color = isError ? 'var(--danger)' : 'var(--muted)';
    setTimeout(() => { syncStatus.textContent = ''; }, 4000);
  }

  function updateSyncUI(user) {
    if (user) {
      syncSignedOut.style.display = 'none';
      syncSignedIn.style.display = 'block';
      syncUserEmail.textContent = user.email || user.displayName || 'Google User';
    } else {
      syncSignedOut.style.display = 'block';
      syncSignedIn.style.display = 'none';
    }
  }

  // Check auth state — only if user has previously signed in (avoid loading
  // Firebase for users who never use sync). We use a lightweight storage flag.
  chrome.storage.local.get({ lastSyncedAt: 0 }, async (data) => {
    if (data.lastSyncedAt > 0) {
      // User has synced before — load Firebase to restore their auth state
      try {
        await loadFirebase();
        firebaseOnAuthStateChanged((user) => {
          updateSyncUI(user);
        });
      } catch (err) {
        console.warn('[Hocus Focus] Firebase lazy-load for auth check failed:', err);
      }
    }
  });

  // Sign In
  signInBtn.addEventListener('click', async () => {
    signInBtn.disabled = true;
    signInBtn.textContent = 'Signing in...';
    try {
      await loadFirebase();
      const user = await signInWithGoogle();
      updateSyncUI(user);
      const result = await syncOnSignIn(user.uid);
      showSyncStatus(result === 'pulled' ? 'Data restored from cloud' : 'Data backed up to cloud');
    } catch (err) {
      console.error('[Hocus Focus] Sign-in error:', err);
      showSyncStatus('Sign-in failed: ' + (err.message || err), true);
    } finally {
      signInBtn.disabled = false;
      signInBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        Sign in with Google`;
    }
  });

  // Sign Out
  signOutBtn.addEventListener('click', async () => {
    try {
      await loadFirebase();
      await signOutUser();
      updateSyncUI(null);
    } catch (err) {
      console.error('[Hocus Focus] Sign-out error:', err);
      showSyncStatus('Sign-out failed', true);
    }
  });

  // Push to Cloud
  pushSyncBtn.addEventListener('click', async () => {
    try {
      await loadFirebase();
    } catch (err) {
      return showSyncStatus('Failed to load sync module', true);
    }
    const user = firebaseCurrentUser();
    if (!user) return showSyncStatus('Not signed in', true);
    pushSyncBtn.disabled = true;
    pushSyncBtn.textContent = 'Pushing...';
    try {
      await pushToCloud(user.uid);
      showSyncStatus('Data pushed to cloud');
    } catch (err) {
      console.error('[Hocus Focus] Push error:', err);
      showSyncStatus('Push failed: ' + err.message, true);
    } finally {
      pushSyncBtn.disabled = false;
      pushSyncBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 11 12 6 7 11"/><line x1="12" y1="6" x2="12" y2="18"/></svg> Push';
    }
  });

  // Pull from Cloud
  pullSyncBtn.addEventListener('click', async () => {
    try {
      await loadFirebase();
    } catch (err) {
      return showSyncStatus('Failed to load sync module', true);
    }
    const user = firebaseCurrentUser();
    if (!user) return showSyncStatus('Not signed in', true);
    pullSyncBtn.disabled = true;
    pullSyncBtn.textContent = 'Pulling...';
    try {
      const success = await pullFromCloud(user.uid);
      if (success) {
        showSyncStatus('Data restored from cloud');
        setTimeout(() => location.reload(), 1000);
      } else {
        showSyncStatus('No cloud data found');
      }
    } catch (err) {
      console.error('[Hocus Focus] Pull error:', err);
      showSyncStatus('Pull failed: ' + err.message, true);
    } finally {
      pullSyncBtn.disabled = false;
      pullSyncBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 13 12 18 17 13"/><line x1="12" y1="18" x2="12" y2="6"/></svg> Pull';
    }
  });
}
