import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { installUpdate } from "../extension/install-update.mjs";

const installed = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
const release = { version: "0.0.99", tag: "v0.0.99" };

function fakeRelease(version = release.version) {
  const manifest = { ...installed, version };
  const files = new Map([["manifest.json", JSON.stringify(manifest)]]);
  const paths = [manifest.background.service_worker, manifest.action.default_popup,
    ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)];
  for (const path of paths) files.set(path, `released: ${path}`);
  const blobs = new Map();
  const tree = Array.from(files, ([path, content]) => {
    const size = Buffer.byteLength(content);
    const sha = createHash("sha1").update(`blob ${size}\0`).update(content).digest("hex");
    blobs.set(sha, content);
    return { path: `extension/${path}`, type: "blob", mode: "100644", size, sha };
  });
  const fetcher = async (url) => {
    if (url.includes("/git/trees/")) return Response.json({ tree });
    return new Response(blobs.get(url.split("/").at(-1)), { status: 200 });
  };
  return { fetcher, tree, blobs };
}

function fakeDirectory(entries = new Map(), failWrite = () => false, prefix = "") {
  return {
    async getDirectoryHandle(name) {
      if (!entries.has(name)) entries.set(name, new Map());
      return fakeDirectory(entries.get(name), failWrite, `${prefix}${name}/`);
    },
    async getFileHandle(name, { create } = {}) {
      if (!create && !entries.has(name)) throw new Error("File not found");
      return {
        async getFile() { return new Blob([entries.get(name)]); },
        async createWritable() {
          let bytes;
          return {
            async write(contents) { bytes = new Blob([contents]); },
            async close() {
              if (failWrite(`${prefix}${name}`)) throw new Error("Write failed");
              entries.set(name, await bytes.text());
            },
            async abort() {},
          };
        },
      };
    },
    async removeEntry(name) { entries.delete(name); },
  };
}

test("switches the root manifest to the staged release and supports updating again", async () => {
  const { fetcher } = fakeRelease();
  const entries = new Map([["manifest.json", JSON.stringify(installed)]]);
  const folder = fakeDirectory(entries);
  await installUpdate(folder, release, installed, async (name) => entries.get(name), fetcher);
  const next = JSON.parse(entries.get("manifest.json"));
  assert.equal(next.version, release.version);
  const [, directory, file] = next.background.service_worker.split("/");
  assert.equal(entries.get("versions").get(directory).get(file), `released: ${installed.background.service_worker}`);
  assert.equal(entries.size, 2);

  const later = { version: "0.0.100", tag: "v0.0.100" };
  await installUpdate(folder, later, next, async (name) => entries.get(name), fakeRelease(later.version).fetcher);
  assert.equal(JSON.parse(entries.get("manifest.json")).version, later.version);
});

test("keeps the current release when choosing a different copy, downloading a corrupt file, or failing to write", async () => {
  const original = JSON.stringify(installed);
  const entries = new Map([["manifest.json", original]]);
  const { tree, blobs, fetcher } = fakeRelease();
  const folder = fakeDirectory(entries);
  await assert.rejects(installUpdate(folder, release, installed, async () => null, fetcher), /読み込んでいる/);
  const fetchPackage = async (name) => entries.get(name);
  const path = tree.find(({ path }) => path === `extension/${installed.background.service_worker}`);
  const valid = blobs.get(path.sha);
  blobs.set(path.sha, "corrupt");
  await assert.rejects(installUpdate(folder, release, installed, fetchPackage, fetcher), /一致しません/);
  assert.deepEqual(entries, new Map([["manifest.json", original]]));

  blobs.set(path.sha, valid);
  const readOnlyManifest = fakeDirectory(entries, (name) => name === "manifest.json");
  await assert.rejects(installUpdate(readOnlyManifest, release, installed, fetchPackage, fetcher), /Write failed/);
  assert.equal(entries.get("manifest.json"), original);
  assert.equal(entries.get("versions").size, 0);
});
