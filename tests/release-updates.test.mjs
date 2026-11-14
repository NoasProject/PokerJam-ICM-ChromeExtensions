import assert from "node:assert/strict";
import { test } from "node:test";
import { checkForReleaseUpdate } from "../extension/release-updates.mjs";

const repository = "NoasProject/PokerJam-ICM-ChromeExtensions";
const apiRepository = `https://api.github.com/repos/${repository}`;

function mockRelease(tag, version, manifestStatus = 200) {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url: String(url), ...options });
    if (requests.length === 1) return Response.json({ tag_name: tag });
    return Response.json({ version }, { status: manifestStatus });
  };
  return { requests, fetcher };
}

test("uses the Chrome version of the released tag, even if the tag looks older", async () => {
  const { requests, fetcher } = mockRelease("build/v0.0.1", "0.4.10");
  assert.deepEqual(await checkForReleaseUpdate("0.4.9", fetcher), {
    version: "0.4.10",
    comparison: 1,
    url: `https://github.com/${repository}/releases/tag/build%2Fv0.0.1`,
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, `${apiRepository}/releases/latest`);
  assert.equal(requests[0].headers.Accept, "application/vnd.github+json");
  assert.equal(
    requests[1].url,
    `${apiRepository}/contents/extension/manifest.json?ref=refs%2Ftags%2Fbuild%2Fv0.0.1`,
  );
  assert.equal(requests[1].headers.Accept, "application/vnd.github.raw+json");
  for (const { method, credentials, redirect } of requests) {
    assert.equal(method, "GET");
    assert.equal(credentials, "omit");
    assert.equal(redirect, "error");
  }
});

test("recognizes matching versions with omitted zeros and newer local versions", async () => {
  const same = mockRelease("v99", "0.4.5.0");
  assert.equal((await checkForReleaseUpdate("0.4.5", same.fetcher)).comparison, 0);
  const older = mockRelease("v99", "0.4.5");
  assert.equal((await checkForReleaseUpdate("0.4.5.1", older.fetcher)).comparison, -1);
});

test("rejects invalid or absent internal versions", async () => {
  for (const version of [undefined, "v1.2.3", "1.02", "65536", "0.0.0"]) {
    const { fetcher } = mockRelease("v1.2.3", version);
    await assert.rejects(checkForReleaseUpdate("0.4.5", fetcher), /Invalid Chrome extension version/);
  }
});

test("reports failed release and manifest requests", async () => {
  await assert.rejects(
    checkForReleaseUpdate("0.4.5", async () => new Response(null, { status: 403 })),
    /Release request failed \(403\)/,
  );
  const { fetcher } = mockRelease("v1.2.3", "1.2.3", 404);
  await assert.rejects(checkForReleaseUpdate("0.4.5", fetcher), /Release manifest request failed \(404\)/);
});
