async function useFolderStore(mode, operation) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("pokerjam-update", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("settings");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction("settings", mode);
      const request = operation(transaction.objectStore("settings"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export function loadUpdateFolder() {
  return useFolderStore("readonly", (store) => store.get("install-folder"));
}

export function saveUpdateFolder(folder) {
  return useFolderStore("readwrite", (store) => store.put(folder, "install-folder"));
}
