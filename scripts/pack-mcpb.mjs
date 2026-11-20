#!/usr/bin/env node
// Builds bedrock-multi-model-mcp-<version>.mcpb in the repo root: the MCP Bundle that Claude
// Desktop and other MCPB hosts install in one click. Run `npm run build` first.
//
// The bundle holds dist (tests left out), dist/data, package.json, LICENSE, README.md, a
// manifest.json stamped with the version from package.json, and production-only node_modules
// (npm ci --omit=dev --ignore-scripts on the copied package-lock.json).
//
// mcpb/manifest.json carries "version": "0.0.0" on purpose: this script overwrites it at pack
// time, so package.json stays the only hand-maintained version besides server.json.
//
// Plain Node, no zip binary and no dependency: the zip is written here with node:zlib. Entries
// carry a fixed timestamp, so one tree always zips to the same bytes.
//
//   node scripts/pack-mcpb.mjs
import { execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

if (!existsSync(join(root, "dist", "index.js")) || !existsSync(join(root, "dist", "data"))) {
  console.error("dist/index.js or dist/data is missing: run npm run build first");
  process.exit(1);
}

const stage = mkdtempSync(join(tmpdir(), "bedrock-mcpb-"));
try {
  // *.test.js, *.test.d.ts and their maps
  const isTest = (p) => /\.test\.[^/\\]*$/.test(p);
  cpSync(join(root, "dist"), join(stage, "dist"), {
    recursive: true,
    filter: (src) => !isTest(src),
  });
  for (const f of ["package.json", "package-lock.json", "LICENSE", "README.md"])
    cpSync(join(root, f), join(stage, f));

  const manifest = JSON.parse(readFileSync(join(root, "mcpb", "manifest.json"), "utf8"));
  manifest.version = pkg.version;
  writeFileSync(join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  // Lifecycle scripts stay off, so prepublishOnly and any dependency install hook never run.
  // One command string through the shell: npm is npm.cmd on Windows.
  execSync("npm ci --omit=dev --ignore-scripts --no-audit --no-fund", {
    cwd: stage,
    stdio: "inherit",
  });
  // The lockfile only fed npm ci; the bundle does not need it.
  rmSync(join(stage, "package-lock.json"));

  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)],
    );
  const names = walk(stage)
    .map((f) => relative(stage, f).replaceAll("\\", "/"))
    .sort();

  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  // DOS time 00:00:00 and date 1980-01-01 (0x0021).
  const parts = [];
  const central = [];
  let offset = 0;
  for (const name of names) {
    const data = readFileSync(join(stage, name));
    const packed = deflateRawSync(data, { level: 9 });
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, packed);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x0021, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(packed.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  const bundle = Buffer.concat([...parts, ...central, end]);
  const file = join(root, `bedrock-multi-model-mcp-${pkg.version}.mcpb`);
  writeFileSync(file, bundle);
  const mb = (statSync(file).size / 1024 / 1024).toFixed(1);
  console.log(`packed ${file}: ${names.length} files, ${mb} MB`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
