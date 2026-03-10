# runmate

Run journal built with React and Vite.

## Shared storage

The app supports two modes:

- Firebase mode: runs and photo URLs are shared across devices.
- Fallback mode: if Firebase env vars are missing, the app falls back to local browser storage and still works without crashing.

To enable shared runs without changing the deployed URL, add these environment variables to your deployment platform and rebuild:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

The required cloud resources are:

- Firestore collection: `runs`
- Firebase Storage bucket for uploaded run photos

The frontend already handles:

- saving `title`
- saving `date`
- saving `distance`
- saving `duration`
- calculating and saving `pace`
- uploading photos and saving photo URLs

If Firebase is not configured yet, the app stays usable and stores runs on the current device only.
