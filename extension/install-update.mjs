import { compareVersions, fetchReleaseFile } from "./release-updates.mjs";

const MANIFEST = "manifest.json";
const MAX_RELEASE_SIZE = 5 * 1024 * 1024;
const MAX_RELEASE_FILES = 100;

async function downloadUpdate({ tag, version }, fetcher) {
  const tree = await fetchReleaseFile(`/git/trees/${encodeURIComponent(`refs/tags/${tag}`)}?recursive=1`, fetcher);
  if (!tree.ok) throw new Error(`更新ファイルの一覧を取得できませんでした（${tree.status}）。`);
  const { tree: entries, truncated } = await tree.json();
  if (truncated || !Array.isArray(entries)) throw new Error("更新ファイルの一覧が不完全です。");

  const files = entries.filter(({ path, type }) => path?.startsWith("extension/") && type !== "tree");
  const names = new Set();
  let totalSize = 0;
  for (const file of files) {
    const name = file.path.slice("extension/".length);
    if (file.type !== "blob" || file.mode !== "100644" || !/^[a-f0-9]{40}$/.test(file.sha) ||
        !Number.isSafeInteger(file.size) || file.size < 0 ||
        !name.split("/").every((part) => /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(part)) ||
        names.has(name.toLowerCase())) {
      throw new Error("更新に対応していないファイルが含まれています。");
    }
    names.add(name.toLowerCase());
    totalSize += file.size;
  }
  if (!names.has(MANIFEST) || files.length > MAX_RELEASE_FILES || totalSize > MAX_RELEASE_SIZE) {
    throw new Error("更新ファイルの構成を確認できませんでした。");
  }

  const contents = new Map();
  for (let index = 0; index < files.length; index += 6) {
    await Promise.all(files.slice(index, index + 6).map(async ({ path, sha, size }) => {
      const response = await fetchReleaseFile(`/git/blobs/${sha}`, fetcher, "application/vnd.github.raw+json");
      if (!response.ok) throw new Error(`更新ファイルを取得できませんでした（${response.status}）。`);
      const bytes = await response.arrayBuffer();
      const blob = new Blob([`blob ${bytes.byteLength}\0`, bytes]);
      const digest = await crypto.subtle.digest("SHA-1", await blob.arrayBuffer());
      const actualSha = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (bytes.byteLength !== size || actualSha !== sha) throw new Error("更新ファイルが公開版と一致しません。");
      contents.set(path.slice("extension/".length), bytes);
    }));
  }
  const manifest = JSON.parse(new TextDecoder().decode(contents.get(MANIFEST)));
  if (manifest.version !== version) throw new Error("更新ファイルのバージョンが公開版と一致しません。");
  return { manifest, contents };
}

async function writeFile(folder, name, contents) {
  const file = await folder.getFileHandle(name, { create: true });
  const writer = await file.createWritable();
  try {
    await writer.write(contents);
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => {});
    throw error;
  }
}

async function isInstallFolder(folder, installed, fetchPackageFile) {
  let manifest;
  try {
    const handle = await folder.getFileHandle(MANIFEST);
    const file = await handle.getFile();
    manifest = JSON.parse(await file.text());
  } catch (error) {
    if (error.name === "NotFoundError" || error.name === "TypeMismatchError" || error instanceof SyntaxError) return false;
    throw error;
  }
  if (manifest?.name !== installed.name || manifest?.version !== installed.version ||
      manifest?.background?.service_worker !== installed.background.service_worker) {
    return false;
  }

  // A copy of the same version can have an identical manifest. Check which folder Chrome actually serves.
  const token = crypto.randomUUID();
  const probe = `pokerjam-update-${token}.txt`;
  try {
    await writeFile(folder, probe, token);
    return await fetchPackageFile(probe).catch(() => null) === token;
  } finally {
    await folder.removeEntry(probe).catch(() => {});
  }
}

async function findInstallFolder(selectedFolder, installed, fetchPackageFile) {
  if (await isInstallFolder(selectedFolder, installed, fetchPackageFile)) return selectedFolder;

  const child = await selectedFolder.getDirectoryHandle("extension").catch((error) => {
    if (error.name === "NotFoundError" || error.name === "TypeMismatchError") return null;
    throw error;
  });
  if (child && await isInstallFolder(child, installed, fetchPackageFile)) return child;
  throw new Error("Chromeが現在読み込んでいるフォルダか、そのフォルダを含む1つ上のフォルダを選んでください。");
}

export async function installUpdate(selectedFolder, release, installed, fetchPackageFile, fetcher = fetch) {
  const folder = await findInstallFolder(selectedFolder, installed, fetchPackageFile);
  const { manifest, contents } = await downloadUpdate(release, fetcher);
  if (manifest.name !== installed.name || manifest.key !== installed.key || manifest.manifest_version !== 3 ||
      compareVersions(manifest.version, installed.version) <= 0) {
    throw new Error("この拡張機能に適用できない更新です。");
  }
  const browserVersion = globalThis.navigator?.userAgent.match(/\bChrome\/([0-9]+(?:\.[0-9]+){0,3})\b/)?.[1];
  if (browserVersion && manifest.minimum_chrome_version &&
      compareVersions(manifest.minimum_chrome_version, browserVersion) > 0) {
    throw new Error(`この更新には Chrome ${manifest.minimum_chrome_version} 以降が必要です。`);
  }

  // Chrome reads only the root manifest. Switch to the complete new folder in one write.
  // A failed write leaves the root manifest pointing at the previous release.
  const folderName = `v${manifest.version}-${crypto.randomUUID()}`;
  const prefix = `versions/${folderName}`;
  const resource = (path) => {
    if (!contents.has(path)) throw new Error(`更新に必要なファイルがありません（${path}）。`);
    return `${prefix}/${path}`;
  };
  const icons = (paths) => Object.fromEntries(Object.entries(paths).map(([size, path]) => [size, resource(path)]));
  const supportedFields = ["manifest_version", "name", "description", "version", "version_name",
    "minimum_chrome_version", "key", "permissions", "host_permissions", "optional_permissions",
    "optional_host_permissions", "icons", "background", "action"];
  if (Object.keys(manifest).some((key) => !supportedFields.includes(key))) {
    throw new Error("この更新には手動でのファイル差し替えが必要です。");
  }
  const nextManifest = {
    ...manifest,
    icons: icons(manifest.icons),
    background: { ...manifest.background, service_worker: resource(manifest.background.service_worker) },
    action: {
      ...manifest.action,
      default_icon: icons(manifest.action.default_icon),
      default_popup: resource(manifest.action.default_popup),
    },
  };

  const versions = await folder.getDirectoryHandle("versions", { create: true });
  const staged = await versions.getDirectoryHandle(folderName, { create: true });
  try {
    for (const [path, bytes] of contents) {
      if (path === MANIFEST) continue;
      const parts = path.split("/");
      const file = parts.pop();
      let directory = staged;
      for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
      await writeFile(directory, file, bytes);
    }
    await writeFile(folder, MANIFEST, `${JSON.stringify(nextManifest, null, 2)}\n`);
  } catch (error) {
    await versions.removeEntry(folderName, { recursive: true }).catch(() => {});
    throw error;
  }
  return folder;
}
