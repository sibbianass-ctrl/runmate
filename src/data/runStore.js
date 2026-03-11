import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';

const STORAGE_KEY = 'runmate:runs';
const QUEUE_KEY = 'runmate:offline-queue';

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

function loadQueue() {
  try {
    const storedQueue = window.localStorage.getItem(QUEUE_KEY);
    if (!storedQueue) {
      return [];
    }

    const parsedQueue = JSON.parse(storedQueue);
    return Array.isArray(parsedQueue) ? parsedQueue : [];
  } catch {
    return [];
  }
}

function saveQueue(queueItems) {
  window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queueItems));
}

function normalizeComments(comments = []) {
  return comments.map((comment) => ({
    ...comment,
    replies: normalizeComments(comment.replies ?? []),
  }));
}

function normalizeRun(run) {
  return {
    ...run,
    comments: normalizeComments(run.comments ?? []),
  };
}

function mergeRunsWithPending(cloudRuns) {
  const localRuns = loadLocalRuns().filter((run) => run.pendingSync);
  return [...localRuns, ...cloudRuns.map((run) => normalizeRun(run))];
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(',');
  const mimeMatch = header.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const binary = window.atob(data);
  const array = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    array[index] = binary.charCodeAt(index);
  }

  return new Blob([array], { type: mime });
}

async function compressImageFile(file) {
  if (!file.type.startsWith('image/')) {
    return file;
  }

  const sourceUrl = await fileToDataUrl(file);
  const image = await new Promise((resolve, reject) => {
    const nextImage = new Image();
    nextImage.onload = () => resolve(nextImage);
    nextImage.onerror = () => reject(new Error(`Failed to decode image: ${file.name}`));
    nextImage.src = sourceUrl;
  });

  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    return file;
  }

  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.82);
  });

  if (!blob) {
    return file;
  }

  return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}

async function normalizeUploadFiles(files) {
  return Promise.all(files.map((file) => compressImageFile(file)));
}

async function createLocalPhotos(runId, files) {
  const normalizedFiles = await normalizeUploadFiles(files);

  return Promise.all(
    normalizedFiles.map(async (file) => ({
      id: `${runId}-${file.name}-${file.lastModified}`,
      title: file.name.replace(/\.[^.]+$/, ''),
      src: await fileToDataUrl(file),
    })),
  );
}

async function createCloudPhotos(runId, files) {
  const normalizedFiles = await normalizeUploadFiles(files);

  return Promise.all(
    normalizedFiles.map(async (file) => {
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

function createQueuedRun(runInput, photos) {
  return {
    ...runInput,
    id: `offline-${Date.now()}`,
    photos,
    pendingSync: true,
    comments: runInput.comments ?? [],
  };
}

async function queueRun(runInput) {
  const photos = await createLocalPhotos(`offline-${Date.now()}`, runInput.photos ?? []);
  const queuedRun = createQueuedRun(runInput, photos);
  const queue = loadQueue();
  queue.push({
    type: 'create-run',
    id: queuedRun.id,
    payload: {
      ...queuedRun,
      photos,
    },
  });
  saveQueue(queue);
  saveLocalRuns([queuedRun, ...loadLocalRuns()]);
  return queuedRun;
}

function queueComment(runId, comment) {
  const queue = loadQueue();
  queue.push({
    type: 'add-comment',
    id: `${runId}-${comment.id}`,
    runId,
    payload: comment,
  });
  saveQueue(queue);
}

export function isCloudEnabled() {
  return hasFirebaseConfig;
}

export function isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export async function fetchRuns() {
  if (!hasFirebaseConfig) {
    return loadLocalRuns().map((run) => normalizeRun(run));
  }

  const runsQuery = query(collection(db, 'runs'), orderBy('createdAtMs', 'desc'));
  const snapshot = await getDocs(runsQuery);
  const cloudRuns = snapshot.docs.map((snapshotDoc) => ({
    id: snapshotDoc.id,
    ...snapshotDoc.data(),
  }));

  return mergeRunsWithPending(cloudRuns);
}

export function subscribeToRuns(onData, onError) {
  if (!hasFirebaseConfig) {
    onData(loadLocalRuns().map((run) => normalizeRun(run)));
    return () => {};
  }

  const runsQuery = query(collection(db, 'runs'), orderBy('createdAtMs', 'desc'));
  return onSnapshot(
    runsQuery,
    (snapshot) => {
      const cloudRuns = snapshot.docs.map((snapshotDoc) => ({
        id: snapshotDoc.id,
        ...snapshotDoc.data(),
      }));
      onData(mergeRunsWithPending(cloudRuns));
    },
    onError,
  );
}

export async function saveRun(runInput) {
  if (!hasFirebaseConfig) {
    const runId = `run-${Date.now()}`;
    const createdRun = {
      ...runInput,
      id: runId,
      comments: runInput.comments ?? [],
      photos: await createLocalPhotos(runId, runInput.photos),
    };

    const nextRuns = [createdRun, ...loadLocalRuns()];
    saveLocalRuns(nextRuns);
    return createdRun;
  }

  if (!isOnline()) {
    return queueRun({ ...runInput, comments: runInput.comments ?? [] });
  }

  const runId = `run-${Date.now()}`;
  const photos = await createCloudPhotos(runId, runInput.photos);
  const docPayload = {
    ...runInput,
    comments: runInput.comments ?? [],
    photos,
    createdAtMs: runInput.createdAtMs ?? Date.now(),
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

function appendReplyToComments(comments, parentCommentId, reply) {
  return comments.map((comment) => {
    if (comment.id === parentCommentId) {
      return {
        ...comment,
        replies: [...(comment.replies ?? []), reply],
      };
    }

    return {
      ...comment,
      replies: comment.replies ?? [],
    };
  });
}

export async function addCommentToRun(run, commentText, author = 'Guest', parentCommentId = null) {
  const comment = {
    id: `comment-${Date.now()}`,
    text: commentText.trim(),
    author,
    createdAt: new Date().toISOString(),
    replies: [],
  };

  const updatedRun = {
    ...run,
    comments: parentCommentId
      ? appendReplyToComments(run.comments ?? [], parentCommentId, comment)
      : [...(run.comments ?? []), comment],
  };

  if (!hasFirebaseConfig) {
    const storedRuns = loadLocalRuns();
    saveLocalRuns(storedRuns.map((storedRun) => (storedRun.id === run.id ? updatedRun : storedRun)));
    return updatedRun;
  }

  if (!isOnline()) {
    queueComment(run.id, comment);
    const localRuns = loadLocalRuns();
    const targetExists = localRuns.some((storedRun) => storedRun.id === run.id);
    const nextRuns = targetExists
      ? localRuns.map((storedRun) => (storedRun.id === run.id ? updatedRun : storedRun))
      : [updatedRun, ...localRuns];
    saveLocalRuns(nextRuns);
    return {
      ...updatedRun,
      pendingSync: run.pendingSync ?? false,
    };
  }

  await updateDoc(doc(db, 'runs', run.id), {
    comments: updatedRun.comments,
  });

  return updatedRun;
}

export async function updateRunComments(run, comments) {
  const updatedRun = {
    ...run,
    comments: normalizeComments(comments),
  };

  if (!hasFirebaseConfig) {
    const storedRuns = loadLocalRuns();
    saveLocalRuns(storedRuns.map((storedRun) => (storedRun.id === run.id ? updatedRun : storedRun)));
    return updatedRun;
  }

  await updateDoc(doc(db, 'runs', run.id), {
    comments: updatedRun.comments,
  });

  return updatedRun;
}

export async function syncPendingRuns() {
  if (!hasFirebaseConfig || !isOnline()) {
    return {
      syncedRuns: [],
      syncedComments: 0,
    };
  }

  const queue = loadQueue();
  if (!queue.length) {
    return {
      syncedRuns: [],
      syncedComments: 0,
    };
  }

  const syncedRuns = [];
  let syncedComments = 0;
  let nextQueue = [...queue];
  let localRuns = loadLocalRuns();

  for (const item of queue) {
    try {
      if (item.type === 'create-run') {
        const payload = item.payload;
        const files = (payload.photos ?? []).map((photo, index) => {
          const blob = dataUrlToBlob(photo.src);
          return new File([blob], `${photo.title || `offline-${index}`}.jpg`, {
            type: blob.type || 'image/jpeg',
            lastModified: Date.now(),
          });
        });

        const savedRun = await saveRun({
          ...payload,
          pendingSync: false,
          photos: files,
        });

        syncedRuns.push(savedRun);
        nextQueue = nextQueue.filter((queuedItem) => queuedItem.id !== item.id);
        localRuns = localRuns.filter((run) => run.id !== item.id);
      }

      if (item.type === 'add-comment') {
        const localRun = localRuns.find((run) => run.id === item.runId);
        if (localRun) {
          const comments = [...(localRun.comments ?? [])];
          const nextRun = {
            ...localRun,
            comments,
          };
          await updateDoc(doc(db, 'runs', item.runId), {
            comments,
          });
          localRuns = localRuns.map((run) => (run.id === item.runId ? nextRun : run));
        }

        syncedComments += 1;
        nextQueue = nextQueue.filter((queuedItem) => queuedItem.id !== item.id);
      }
    } catch {
      // Stop at first failure to keep order predictable.
      break;
    }
  }

  saveQueue(nextQueue);
  saveLocalRuns(localRuns.filter((run) => run.pendingSync));

  return {
    syncedRuns,
    syncedComments,
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
        await deleteObject(ref(storage, photo.path || photo.src));
      } catch {
        // Ignore missing/deleted photos so the run record can still be removed.
      }
    }),
  );

  await deleteDoc(doc(db, 'runs', run.id));
}
