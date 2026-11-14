const DATABASE_NAME = "shiftdeck-uploads";
const STORE_NAME = "schedule-images";
const DATABASE_VERSION = 1;

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const runRequest = async <T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) => {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
};

type ScheduleImages = { original: Blob; deskewed: Blob };

export const saveScheduleImage = (id: string, image: Blob, deskewed?: Blob) =>
  runRequest("readwrite", (store) => store.put(
    deskewed ? { original: image, deskewed } : image,
    id,
  ));

export const loadScheduleImage = async (id: string, deskewed = false) => {
  const saved = await runRequest<Blob | ScheduleImages | undefined>(
    "readonly",
    (store) => store.get(id),
  );
  return saved instanceof Blob
    ? deskewed ? undefined : saved
    : deskewed ? saved?.deskewed : saved?.original;
};

export const deleteScheduleImage = (id: string) =>
  runRequest("readwrite", (store) => store.delete(id));

export const clearScheduleImages = () =>
  runRequest("readwrite", (store) => store.clear());
