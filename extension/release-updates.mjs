const REPOSITORY = "NoasProject/PokerJam-ICM-ChromeExtensions";
const API_REPOSITORY = `https://api.github.com/repos/${REPOSITORY}`;
const UPDATE_TIMEOUT_MS = 10_000;

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

export async function fetchReleaseFile(path, fetcher = fetch, accept = "application/vnd.github+json") {
  return fetcher(`${API_REPOSITORY}${path}`, {
    method: "GET",
    credentials: "omit",
    redirect: "error",
    cache: "no-cache",
    signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS),
    headers: { Accept: accept },
  });
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
  return {
    tag,
    version,
    comparison: compareVersions(version, installedVersion),
    url: `https://github.com/${REPOSITORY}/releases/tag/${encodeURIComponent(tag)}`,
  };
}
