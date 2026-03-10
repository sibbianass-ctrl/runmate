import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  updateDoc,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';

const STORAGE_KEY = 'runmate:runs';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const hasFirebaseConfig = Object.values(firebaseConfig).every(Boolean);

const firebaseApp = hasFirebaseConfig
  ? getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;

const db = firebaseApp ? getFirestore(firebaseApp) : null;
const storage = firebaseApp ? getStorage(firebaseApp) : null;

function loadLocalRuns() {
  try {
    const storedRuns = window.localStorage.getItem(STORAGE_KEY);
    if (!storedRuns) {
      return [];
    }

    const parsedRuns = JSON.parse(storedRuns);
    return Array.isArray(parsedRuns) ? parsedRuns : [];
  } catch {
    return [];
  }
}

function saveLocalRuns(runs) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function createLocalPhotos(runId, files) {
  return Promise.all(
    files.map(async (file) => ({
      id: `${runId}-${file.name}-${file.lastModified}`,
      title: file.name.replace(/\.[^.]+$/, ''),
      src: await fileToDataUrl(file),
    })),
  );
}

async function createCloudPhotos(runId, files) {
  return Promise.all(
    files.map(async (file) => {
      const photoRef = ref(storage, `runs/${runId}/${Date.now()}-${file.name}`);
      await uploadBytes(photoRef, file);
      return {
        id: `${runId}-${file.name}-${file.lastModified}`,
        title: file.name.replace(/\.[^.]+$/, ''),
        path: photoRef.fullPath,
        src: await getDownloadURL(photoRef),
      };
    }),
  );
}

export function isCloudEnabled() {
  return hasFirebaseConfig;
}

export async function fetchRuns() {
  if (!hasFirebaseConfig) {
    return loadLocalRuns();
  }

  const runsQuery = query(collection(db, 'runs'), orderBy('createdAtMs', 'desc'));
  const snapshot = await getDocs(runsQuery);

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

export async function saveRun(runInput) {
  if (!hasFirebaseConfig) {
    const runId = `run-${Date.now()}`;
    const createdRun = {
      ...runInput,
      id: runId,
      photos: await createLocalPhotos(runId, runInput.photos),
    };

    const nextRuns = [createdRun, ...loadLocalRuns()];
    saveLocalRuns(nextRuns);
    return createdRun;
  }

  const runId = `run-${Date.now()}`;
  const photos = await createCloudPhotos(runId, runInput.photos);
  const docPayload = {
    ...runInput,
    photos,
    createdAtMs: Date.now(),
  };

  const docRef = await addDoc(collection(db, 'runs'), docPayload);
  return {
    ...docPayload,
    id: docRef.id,
  };
}

export async function updateRun(runId, runInput, newFiles = []) {
  if (!runId) {
    throw new Error('Run id is required');
  }

  if (!hasFirebaseConfig) {
    const storedRuns = loadLocalRuns();
    const currentRun = storedRuns.find((run) => run.id === runId);
    if (!currentRun) {
      throw new Error('Run not found');
    }

    const nextPhotos = newFiles.length ? await createLocalPhotos(runId, newFiles) : [];
    const updatedRun = {
      ...currentRun,
      ...runInput,
      id: runId,
      photos: [...(runInput.photos ?? currentRun.photos ?? []), ...nextPhotos],
    };

    saveLocalRuns(storedRuns.map((run) => (run.id === runId ? updatedRun : run)));
    return updatedRun;
  }

  const nextPhotos = newFiles.length ? await createCloudPhotos(runId, newFiles) : [];
  const docPayload = {
    ...runInput,
    photos: [...(runInput.photos ?? []), ...nextPhotos],
  };

  await updateDoc(doc(db, 'runs', runId), docPayload);
  return {
    ...docPayload,
    id: runId,
  };
}

export async function deletePhotoFromRun(run, photoId) {
  if (!run?.id || !photoId) {
    return run;
  }

  const remainingPhotos = (run.photos ?? []).filter((photo) => photo.id !== photoId);
  const removedPhoto = (run.photos ?? []).find((photo) => photo.id === photoId);

  if (!hasFirebaseConfig) {
    const storedRuns = loadLocalRuns();
    const updatedRun = {
      ...run,
      photos: remainingPhotos,
    };

    saveLocalRuns(storedRuns.map((storedRun) => (storedRun.id === run.id ? updatedRun : storedRun)));
    return updatedRun;
  }

  if (removedPhoto) {
    try {
      await deleteObject(ref(storage, removedPhoto.path || removedPhoto.src));
    } catch {
      // Ignore missing files so metadata can still be updated.
    }
  }

  const updatedRun = {
    ...run,
    photos: remainingPhotos,
  };

  await updateDoc(doc(db, 'runs', run.id), {
    photos: remainingPhotos,
  });

  return updatedRun;
}

export async function deleteRun(run) {
  if (!run?.id) {
    return;
  }

  if (!hasFirebaseConfig) {
    const nextRuns = loadLocalRuns().filter((storedRun) => storedRun.id !== run.id);
    saveLocalRuns(nextRuns);
    return;
  }

  await Promise.all(
    (run.photos ?? []).map(async (photo) => {
      try {
        await deleteObject(ref(storage, photo.src));
      } catch {
        // Ignore missing/deleted photos so the run record can still be removed.
      }
    }),
  );

  await deleteDoc(doc(db, 'runs', run.id));
}
