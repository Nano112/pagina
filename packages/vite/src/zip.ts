/**
 * A deliberately small, deliberately strict ZIP reader and writer.
 *
 * pagina parses archives that arrive from elsewhere, which is the one job where a general-purpose
 * library is a liability rather than a convenience: the interesting attacks on ZIP are all
 * *tolerances* — a name in the local header that disagrees with the central directory, an entry
 * whose declared size is a lie, a member that is really a symlink — and a library's job is to be
 * tolerant. So this reader implements one dialect and refuses everything else:
 *
 * - the central directory is the only index; local headers are read solely to confirm they agree
 * - no ZIP64, no data descriptors, no encryption, no multi-disk, no archive comment we act on
 * - only stored (0) and deflate (8), because that is all `writeZip` produces
 * - the declared uncompressed size is capped *before* inflating, and `maxOutputLength` caps it
 *   again during, so a bomb is refused rather than absorbed
 * - anything the external attributes say is not a regular file is refused
 *
 * `writeZip` is the other half of that contract, and it is deterministic: entries in the order
 * given, one fixed timestamp, no extra fields. Two packs of one folder produce one byte sequence.
 */
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { BundleError, assertSafeBundlePath, type BundleEntry, type BundleErrorCode } from "@pagina/core";

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;

const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;
const EOCD_SIZE = 22;

/** MS-DOS 1980-01-01 00:00:00 — one fixed instant, so a bundle's bytes do not move with the clock. */
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;

/** Unix host, ZIP 2.0, and `0644` in the high half of the external attributes: a regular file. */
const VERSION_MADE_BY = (3 << 8) | 20;
const VERSION_NEEDED = 20;
const FLAG_UTF8 = 0x0800;
const REGULAR_FILE_ATTRS = (0o100644 << 16) >>> 0;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** The file-type nibble of a unix mode, and the two values that are not a regular file. */
const S_IFMT = 0xf000;
const S_IFREG = 0x8000;
const S_IFLNK = 0xa000;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

/** The largest a single member, or the whole archive, may be without needing ZIP64. */
const MAX_U32 = 0xffffffff;

/**
 * Encodes entries into a ZIP archive, in the order given.
 *
 * Deterministic by construction: no timestamps from the clock, no extra fields, no comment, and
 * `deflateRawSync` at zlib's default level, which is a pure function of its input.
 */
export function writeZip(entries: readonly BundleEntry[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const raw = Buffer.from(entry.data);
    const deflated = raw.byteLength === 0 ? undefined : deflateRawSync(raw);
    // Storing is not just a fallback: for already-compressed media, deflate is bigger, and an
    // archive that grows the file it holds is a strange thing to hand someone.
    const useDeflate = deflated !== undefined && deflated.byteLength < raw.byteLength;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE;
    const crc = crc32(entry.data);
    if (raw.byteLength > MAX_U32 || body.byteLength > MAX_U32)
      throw new BundleError("bundle-size", `${entry.path} is too large for a non-ZIP64 archive`);

    const local = Buffer.alloc(LOCAL_HEADER);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.byteLength, 18);
    local.writeUInt32LE(raw.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(CENTRAL_HEADER);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(VERSION_MADE_BY, 4);
    central.writeUInt16LE(VERSION_NEEDED, 6);
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.byteLength, 20);
    central.writeUInt32LE(raw.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(REGULAR_FILE_ATTRS, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.byteLength + name.byteLength + body.byteLength;
  }
  const centralBytes = Buffer.concat(centrals);
  const eocd = Buffer.alloc(EOCD_SIZE);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.byteLength, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return new Uint8Array(Buffer.concat([...locals, centralBytes, eocd]));
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

export interface ReadZipLimits {
  readonly maxEntries: number;
  readonly maxFileSize: number;
  readonly maxTotalSize: number;
  /** Declared uncompressed bytes per archive byte. Checked before anything is inflated. */
  readonly maxRatio: number;
}

function refuse(code: BundleErrorCode, message: string): never {
  throw new BundleError(code, message);
}

/** Finds the end-of-central-directory record, scanning back from the end for its signature. */
function findEocd(buf: Buffer): number {
  const start = Math.max(0, buf.byteLength - EOCD_SIZE - 0xffff);
  for (let i = buf.byteLength - EOCD_SIZE; i >= start; i--)
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  return refuse("bundle-format", "not a ZIP archive: no end-of-central-directory record");
}

/**
 * Decodes an archive into its members, refusing anything outside the dialect above.
 *
 * Nothing is written and nothing is inflated until the whole central directory has been read and
 * every declared size has been checked, so an archive that intends to fill a disk is refused
 * while it is still a few hundred bytes of headers.
 */
export function readZip(archive: Uint8Array, limits: ReadZipLimits): BundleEntry[] {
  const buf = Buffer.from(archive);
  if (buf.byteLength < EOCD_SIZE) refuse("bundle-format", "not a ZIP archive: too short");
  const eocd = findEocd(buf);
  // A ZIP64 locator sits immediately before the EOCD. We do not read ZIP64, and silently reading
  // the 32-bit fields of an archive that has 64-bit ones is how a reader gets the wrong file.
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === ZIP64_LOCATOR_SIG)
    refuse("bundle-format", "ZIP64 archives are not supported");
  if (buf.readUInt16LE(eocd + 4) !== 0 || buf.readUInt16LE(eocd + 6) !== 0)
    refuse("bundle-format", "multi-disk archives are not supported");
  const count = buf.readUInt16LE(eocd + 10);
  if (count !== buf.readUInt16LE(eocd + 8)) refuse("bundle-format", "the archive disagrees with itself about how many entries it has");
  if (count === 0xffff) refuse("bundle-format", "ZIP64 archives are not supported");
  if (count > limits.maxEntries) refuse("bundle-entry-count", `${String(count)} entries exceeds the limit of ${String(limits.maxEntries)}`);
  const centralSize = buf.readUInt32LE(eocd + 12);
  const centralOffset = buf.readUInt32LE(eocd + 16);
  if (centralOffset + centralSize > buf.byteLength) refuse("bundle-format", "the central directory runs past the end of the archive");

  interface Member { name: string; method: number; crc: number; compressed: number; uncompressed: number; offset: number }
  const members: Member[] = [];
  let p = centralOffset;
  let declaredTotal = 0;
  for (let i = 0; i < count; i++) {
    if (p + CENTRAL_HEADER > centralOffset + centralSize) refuse("bundle-format", "the central directory is truncated");
    if (buf.readUInt32LE(p) !== CENTRAL_SIG) refuse("bundle-format", `central directory entry ${String(i)} has a bad signature`);
    const madeBy = buf.readUInt16LE(p + 4);
    const flags = buf.readUInt16LE(p + 8);
    // Bit 0 is encryption; bit 3 puts the sizes in a trailing descriptor, which means the central
    // directory is no longer the only place they live.
    if ((flags & 0x0001) !== 0) refuse("bundle-format", "encrypted archives are not supported");
    if ((flags & 0x0008) !== 0) refuse("bundle-format", "archives with data descriptors are not supported");
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressed = buf.readUInt32LE(p + 20);
    const uncompressed = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const externalAttrs = buf.readUInt32LE(p + 38);
    const offset = buf.readUInt32LE(p + 42);
    if (compressed === MAX_U32 || uncompressed === MAX_U32 || offset === MAX_U32)
      refuse("bundle-format", "ZIP64 archives are not supported");
    const name = buf.toString("utf8", p + CENTRAL_HEADER, p + CENTRAL_HEADER + nameLen);
    // A unix-made archive carries the file mode in the high half of the external attributes. A
    // symlink extracted as a file is the classic escape: the *link* stays inside the destination
    // while everything written through it does not.
    if ((madeBy >> 8) === 3) {
      const mode = (externalAttrs >>> 16) & 0xffff;
      if (mode !== 0 && (mode & S_IFMT) !== S_IFREG) {
        if ((mode & S_IFMT) === S_IFLNK) refuse("bundle-symlink", `${name} is a symlink`);
        refuse("bundle-symlink", `${name} is not a regular file`);
      }
    }
    if (name.endsWith("/")) refuse("bundle-path", `${name} is a directory entry; a bundle lists files only`);
    // The path policy applies at *decode* time, so an archive carrying `../../etc/passwd` is
    // refused whole — before its descriptor is read, before its checksums are looked at, and
    // certainly before anything is written.
    assertSafeBundlePath(name);
    if (method !== METHOD_STORE && method !== METHOD_DEFLATE)
      refuse("bundle-format", `${name} uses compression method ${String(method)}; only store and deflate are supported`);
    if (uncompressed > limits.maxFileSize)
      refuse("bundle-size", `${name} declares ${String(uncompressed)} bytes, over the ${String(limits.maxFileSize)}-byte file limit`);
    declaredTotal += uncompressed;
    if (declaredTotal > limits.maxTotalSize)
      refuse("bundle-size", `the archive declares more than ${String(limits.maxTotalSize)} uncompressed bytes`);
    if (offset + LOCAL_HEADER > buf.byteLength) refuse("bundle-format", `${name} points past the end of the archive`);
    members.push({ name, method, crc, compressed, uncompressed, offset });
    p += CENTRAL_HEADER + nameLen + extraLen + commentLen;
  }
  // The bomb check, on what the archive *says* it holds, before a byte of it is inflated.
  if (buf.byteLength > 0 && declaredTotal / buf.byteLength > limits.maxRatio)
    refuse("bundle-ratio", `compression ratio ${(declaredTotal / buf.byteLength).toFixed(1)}:1 exceeds the limit of ${String(limits.maxRatio)}:1`);

  const out: BundleEntry[] = [];
  for (const m of members) {
    if (buf.readUInt32LE(m.offset) !== LOCAL_SIG) refuse("bundle-format", `${m.name} has no local file header`);
    const nameLen = buf.readUInt16LE(m.offset + 26);
    const extraLen = buf.readUInt16LE(m.offset + 28);
    const localName = buf.toString("utf8", m.offset + LOCAL_HEADER, m.offset + LOCAL_HEADER + nameLen);
    // The disagreement that a tolerant reader resolves in the attacker's favour: extractors that
    // use the local name and validators that use the central one see two different archives.
    if (localName !== m.name) refuse("bundle-path", `${m.name} is named ${localName} in its local header`);
    const start = m.offset + LOCAL_HEADER + nameLen + extraLen;
    const end = start + m.compressed;
    if (end > buf.byteLength) refuse("bundle-format", `${m.name} runs past the end of the archive`);
    const body = buf.subarray(start, end);
    let data: Buffer;
    if (m.method === METHOD_STORE) {
      data = Buffer.from(body);
    } else {
      try {
        // The declared size is the cap, and the cap is enforced by zlib itself: a member that
        // inflates past what it promised throws here rather than after filling memory.
        data = inflateRawSync(body, { maxOutputLength: m.uncompressed });
      } catch {
        refuse("bundle-size", `${m.name} does not inflate to the ${String(m.uncompressed)} bytes it declares`);
      }
    }
    if (data.byteLength !== m.uncompressed)
      refuse("bundle-size", `${m.name} is ${String(data.byteLength)} bytes but declares ${String(m.uncompressed)}`);
    if (crc32(data) !== m.crc) refuse("bundle-checksum", `${m.name} fails its CRC-32`);
    out.push({ path: m.name, data: new Uint8Array(data) });
  }
  return out;
}
