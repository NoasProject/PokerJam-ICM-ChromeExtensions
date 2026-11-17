const MAX_ZIP_SIZE = 16 * 1024 * 1024;
const MAX_EXTRACTED_SIZE = 5 * 1024 * 1024;
const MAX_FILES = 100;
const ZIP_END = 0x06054b50;
const ZIP_DIRECTORY_ENTRY = 0x02014b50;
const ZIP_LOCAL_ENTRY = 0x04034b50;
const decoder = new TextDecoder();

async function readBounded(stream, limit, message) {
  if (!stream) throw new Error("更新ZIPを読み込めませんでした。");
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel().catch(() => {});
        throw new Error(message);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Uint8Array(await new Blob(chunks).arrayBuffer());
}

function readDirectory(view) {
  // ZIP stores filenames and sizes in the central directory at the end of the archive.
  const last = view.byteLength - 22;
  for (let end = last; end >= Math.max(0, last - 0xffff); end--) {
    if (view.getUint32(end, true) !== ZIP_END || end + 22 + view.getUint16(end + 20, true) !== view.byteLength) continue;
    const count = view.getUint16(end + 10, true);
    const start = view.getUint32(end + 16, true);
    const size = view.getUint32(end + 12, true);
    if (view.getUint32(end + 4, true) === 0 && view.getUint16(end + 8, true) === count &&
        start + size === end && count * 46 <= size) {
      return { count, start, end };
    }
  }
  throw new Error("更新ZIPのファイル一覧を読み込めませんでした。");
}

const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  for (let bit = 0; bit < 8; bit++) byte = (byte >>> 1) ^ (byte & 1 ? 0xedb88320 : 0);
  return byte;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

async function extractEntry(bytes, view, entry, directoryStart) {
  const { archiveName, offset, flags, method, size, compressedSize, checksum } = entry;
  if (offset + 30 > directoryStart || view.getUint32(offset, true) !== ZIP_LOCAL_ENTRY ||
      view.getUint16(offset + 6, true) !== flags || view.getUint16(offset + 8, true) !== method) {
    throw new Error("更新ZIPのファイル情報が不正です。");
  }
  const nameEnd = offset + 30 + view.getUint16(offset + 26, true);
  const dataStart = nameEnd + view.getUint16(offset + 28, true);
  if (dataStart + compressedSize > directoryStart || decoder.decode(bytes.subarray(offset + 30, nameEnd)) !== archiveName) {
    throw new Error("更新ZIPのファイル情報が不正です。");
  }
  const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
  const contents = method === 0 ? compressed : await readBounded(
    new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw")),
    size,
    "更新ZIPの展開サイズが一致しません。",
  );
  if (contents.byteLength !== size || crc32(contents) !== checksum) throw new Error("更新ZIPのファイルが破損しています。");
  return contents;
}

export async function extractReleaseFiles(body, prefix) {
  const bytes = await readBounded(body, MAX_ZIP_SIZE, "更新ZIPのサイズが上限を超えています。");
  const view = new DataView(bytes.buffer);
  const { count, start, end } = readDirectory(view);
  const entries = new Map();
  let offset = start;
  let totalSize = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== ZIP_DIRECTORY_ENTRY) {
      throw new Error("更新ZIPのファイル一覧が不正です。");
    }
    const nameEnd = offset + 46 + view.getUint16(offset + 28, true);
    const next = nameEnd + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (next > end) throw new Error("更新ZIPのファイル名が不正です。");
    const archiveName = decoder.decode(bytes.subarray(offset + 46, nameEnd));
    if (archiveName.startsWith(prefix) && !archiveName.endsWith("/")) {
      const name = archiveName.slice(prefix.length);
      const flags = view.getUint16(offset + 8, true);
      const method = view.getUint16(offset + 10, true);
      const attributes = view.getUint32(offset + 38, true);
      const fileType = (attributes >>> 16) & 0o170000;
      const key = name.toLowerCase();
      if (!name.split("/").every((part) => /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(part) && !part.endsWith(".")) || entries.has(key) ||
          (flags & ~0x080e) !== 0 || (method !== 0 && method !== 8) || view.getUint16(offset + 34, true) !== 0 ||
          (attributes & 0x10) || (fileType && fileType !== 0o100000)) {
        throw new Error("更新ZIPに対応していないファイルが含まれています。");
      }
      const size = view.getUint32(offset + 24, true);
      totalSize += size;
      if (entries.size >= MAX_FILES || totalSize > MAX_EXTRACTED_SIZE) throw new Error("更新ファイルのサイズが上限を超えています。");
      entries.set(key, {
        name, archiveName, flags, method, size,
        checksum: view.getUint32(offset + 16, true),
        compressedSize: view.getUint32(offset + 20, true),
        offset: view.getUint32(offset + 42, true),
      });
    }
    offset = next;
  }
  if (offset !== end || entries.get("manifest.json")?.name !== "manifest.json") {
    throw new Error("更新ZIPに拡張機能の manifest.json がありません。");
  }

  const contents = new Map();
  for (const entry of entries.values()) contents.set(entry.name, await extractEntry(bytes, view, entry, start));
  return contents;
}
