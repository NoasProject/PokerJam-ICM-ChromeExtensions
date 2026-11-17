const REPOSITORY = "NoasProject/PokerJam-ICM-ChromeExtensions";
const API_REPOSITORY = `https://api.github.com/repos/${REPOSITORY}`;
const UPDATE_TIMEOUT_MS = 10_000;
const CHECKED_RELEASE_KEY = "pokerjam-checked-release";

function versionParts(version) {
  if (typeof version !== "string" || !/^(0|[1-9][0-9]{0,4})(\.(0|[1-9][0-9]{0,4})){0,3}$/.test(version)) {
    throw new Error("Invalid Chrome extension version");
  }
  const parts = version.split(".").map(Number);
  if (parts.some((part) => part > 65535) || parts.every((part) => part === 0)) {
    throw new Error("Invalid Chrome extension version");
  }
  return parts;
}

export function compareVersions(releaseVersion, installedVersion) {
  const latest = versionParts(releaseVersion);
  const installed = versionParts(installedVersion);
  for (let index = 0; index < 4; index++) {
    const difference = (latest[index] ?? 0) - (installed[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

async function fetchReleaseFile(path, fetcher, accept = "application/vnd.github+json") {
  return fetcher(`${API_REPOSITORY}${path}`, {
    method: "GET",
    credentials: "omit",
    redirect: "error",
    cache: "no-cache",
    signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS),
    headers: { Accept: accept },
  });
}

export async function fetchReleaseArchive(tag, fetcher = fetch) {
  const commit = await fetchReleaseFile(`/commits/${encodeURIComponent(`refs/tags/${tag}`)}`, fetcher);
  if (!commit.ok) throw new Error(`公開版のコミットを取得できませんでした（${commit.status}）。`);
  const { sha } = await commit.json();
  if (typeof sha !== "string" || !/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error("公開版のコミットを確認できませんでした。");
  }

  const archive = await fetcher(`https://codeload.github.com/${REPOSITORY}/zip/${sha}`, {
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  if (!archive.ok) throw new Error(`更新ZIPをダウンロードできませんでした（${archive.status}）。`);

  const repositoryName = REPOSITORY.split("/")[1];
  return { body: archive.body, prefix: `${repositoryName}-${sha}/extension/` };
}

export async function checkForReleaseUpdate(installedVersion, fetcher = fetch) {
  const release = await fetchReleaseFile("/releases/latest", fetcher);
  if (!release.ok) throw new Error(`Release request failed (${release.status})`);
  const { tag_name: tag } = await release.json();
  if (typeof tag !== "string" || !tag) throw new Error("Release tag missing");

  const ref = new URLSearchParams({ ref: `refs/tags/${tag}` });
  const manifest = await fetchReleaseFile(
    `/contents/extension/manifest.json?${ref}`, fetcher, "application/vnd.github.raw+json",
  );
  if (!manifest.ok) throw new Error(`Release manifest request failed (${manifest.status})`);

  const { version } = await manifest.json();
  return releaseInfo(tag, version, installedVersion);
}

function releaseInfo(tag, version, installedVersion) {
  return {
    tag,
    version,
    comparison: compareVersions(version, installedVersion),
    url: `https://github.com/${REPOSITORY}/releases/tag/${encodeURIComponent(tag)}`,
  };
}

export function rememberCheckedRelease({ tag, version }) {
  try {
    sessionStorage.setItem(CHECKED_RELEASE_KEY, JSON.stringify({ tag, version }));
  } catch {
    // The update page can check GitHub if session storage is unavailable.
  }
}

export function readCheckedRelease(installedVersion) {
  try {
    const checked = JSON.parse(sessionStorage.getItem(CHECKED_RELEASE_KEY));
    if (typeof checked?.tag === "string" && checked.tag) {
      return releaseInfo(checked.tag, checked.version, installedVersion);
    }
  } catch {
    // Treat an inaccessible or invalid entry as a cache miss.
  }
  return null;
}
