import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { crc32, deflateRawSync } from "node:zlib";
import { installUpdate } from "../extension/install-update.mjs";

const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
const installed = { ...manifest, version: "0.0.9" };
const release = { version: "1.0.1", tag: "v1.0.1" };
const later = { version: "1.0.2", tag: "v1.0.2" };
const sha = "d7f4dea2a6fbf3cf3f83bb943038d3d3d5961324";
const repository = "NoasProject/PokerJam-ICM-ChromeExtensions";
const archiveRoot = `PokerJam-ICM-ChromeExtensions-${sha}`;

function makeZip(files) {
  const local = [];
  const directory = [];
  const dataOffsets = new Map();
  let offset = 0;
  for (const [path, contents] of files) {
    const name = Buffer.from(path);
    const bytes = Buffer.from(contents);
    const method = path.endsWith(".js") ? 0 : 8;
    const compressed = method === 0 ? bytes : deflateRawSync(bytes);
    const checksum = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    dataOffsets.set(path, offset + header.length + name.length);
    local.push(header, name, compressed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(bytes.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    directory.push(entry, name);
    offset += header.length + name.length + compressed.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return { archive: Buffer.concat([...local, central, end]), dataOffsets };
}

function fakeRelease(version = release.version, additionalFiles = []) {
  const manifest = { ...installed, version };
  const prefix = `${archiveRoot}/extension/`;
  const files = new Map([[`${prefix}manifest.json`, JSON.stringify(manifest)],
    [`${archiveRoot}/README.md`, "release readme"], ...additionalFiles]);
  const paths = [manifest.background.service_worker, manifest.action.default_popup,
    ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)];
  for (const path of paths) files.set(`${prefix}${path}`, `released: ${path}`);
  const { archive, dataOffsets } = makeZip(files);
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push(String(url));
    assert.equal(options.credentials, "omit");
    if (url.startsWith(`https://api.github.com/repos/${repository}/commits/`)) return Response.json({ sha });
    assert.equal(url, `https://codeload.github.com/${repository}/zip/${sha}`);
    return new Response(archive);
  };
  return { fetcher, archive, dataOffsets, requests };
}

function fakeDirectory(entries = new Map(), failWrite = () => false, prefix = "") {
  return {
    async getDirectoryHandle(name, { create } = {}) {
      if (!create && !entries.has(name)) throw new DOMException("Folder not found", "NotFoundError");
      if (!entries.has(name)) entries.set(name, new Map());
      if (!(entries.get(name) instanceof Map)) throw new DOMException("Not a folder", "TypeMismatchError");
      return fakeDirectory(entries.get(name), failWrite, `${prefix}${name}/`);
    },
    async getFileHandle(name, { create } = {}) {
      if (!create && !entries.has(name)) throw new DOMException("File not found", "NotFoundError");
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
  const { fetcher, requests } = fakeRelease();
  const entries = new Map([["manifest.json", JSON.stringify(installed)]]);
  const folder = fakeDirectory(entries);
  await installUpdate(folder, release, installed, async (name) => entries.get(name), fetcher);
  const next = JSON.parse(entries.get("manifest.json"));
  assert.equal(next.version, release.version);
  const [, directory, file] = next.background.service_worker.split("/");
  const staged = entries.get("versions").get(directory);
  assert.equal(staged.get(file), `released: ${installed.background.service_worker}`);
  assert.equal(staged.has("README.md"), false);
  assert.deepEqual(requests, [
    `https://api.github.com/repos/${repository}/commits/refs%2Ftags%2F${release.tag}`,
    `https://codeload.github.com/${repository}/zip/${sha}`,
  ]);
  assert.equal(entries.size, 2);

  await installUpdate(folder, later, next, async (name) => entries.get(name), fakeRelease(later.version).fetcher);
  assert.equal(JSON.parse(entries.get("manifest.json")).version, later.version);
});

test("accepts the parent folder and returns the immediate extension folder for reuse", async () => {
  const original = JSON.stringify(installed);
  const entries = new Map([["manifest.json", original]]);
  const parent = new Map([["extension", entries], ["README.md", "readme"]]);
  const fetchPackage = async (name) => entries.get(name);
  const folder = await installUpdate(fakeDirectory(parent), release, installed, fetchPackage, fakeRelease().fetcher);
  const next = JSON.parse(entries.get("manifest.json"));
  assert.equal(next.version, release.version);
  assert.deepEqual([...parent.keys()], ["extension", "README.md"]);
  assert.equal(parent.get("README.md"), "readme");

  await installUpdate(folder, later, next, fetchPackage, fakeRelease(later.version).fetcher);
  assert.equal(JSON.parse(entries.get("manifest.json")).version, later.version);
});

test("rejects a parent containing an extension copy or a folder more than one level above", async () => {
  const original = JSON.stringify(installed);
  const entries = new Map([["manifest.json", original]]);
  const parent = new Map([["extension", entries]]);
  const outer = new Map([["project", parent]]);
  const { fetcher } = fakeRelease();
  await assert.rejects(installUpdate(fakeDirectory(parent), release, installed, async () => null, fetcher), /読み込んでいる/);
  await assert.rejects(installUpdate(fakeDirectory(outer), release, installed, async (name) => entries.get(name), fetcher), /読み込んでいる/);
  assert.deepEqual(outer, new Map([["project", new Map([["extension", new Map([["manifest.json", original]])]])]]));
});

test("keeps the current release when choosing a different copy, downloading a corrupt file, or failing to write", async () => {
  const original = JSON.stringify(installed);
  const entries = new Map([["manifest.json", original]]);
  const { archive, dataOffsets, fetcher } = fakeRelease();
  const folder = fakeDirectory(entries);
  await assert.rejects(installUpdate(folder, release, installed, async () => null, fetcher), /読み込んでいる/);
  const fetchPackage = async (name) => entries.get(name);
  const offset = dataOffsets.get(`${archiveRoot}/extension/${installed.background.service_worker}`);
  archive[offset] ^= 1;
  await assert.rejects(installUpdate(folder, release, installed, fetchPackage, fetcher), /破損しています/);
  assert.deepEqual(entries, new Map([["manifest.json", original]]));

  archive[offset] ^= 1;
  const readOnlyManifest = fakeDirectory(entries, (name) => name === "manifest.json");
  await assert.rejects(installUpdate(readOnlyManifest, release, installed, fetchPackage, fetcher), /Write failed/);
  assert.equal(entries.get("manifest.json"), original);
  assert.equal(entries.get("versions").size, 0);
});

test("rejects archive entries that escape the extension folder or collide on disk", async () => {
  const original = JSON.stringify(installed);
  const entries = new Map([["manifest.json", original]]);
  for (const path of ["../outside.js", "MANIFEST.JSON", "manifest.json."]) {
    const { fetcher } = fakeRelease(release.version, [[`${archiveRoot}/extension/${path}`, "invalid"]]);
    await assert.rejects(installUpdate(fakeDirectory(entries), release, installed, async (name) => entries.get(name), fetcher),
      /対応していないファイル/);
    assert.deepEqual(entries, new Map([["manifest.json", original]]));
  }
});
