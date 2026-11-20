import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { buildLumaRayInput, readKeyframeImage, readJpegSize, type KeyframeImage } from "./video.js";
import { buildCohereBody, buildTitanBody, embedInputs } from "./embed.js";

const dir = mkdtempSync(join(tmpdir(), "bedrock-media-"));

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// A real 1-bit grayscale PNG; all-zero rows deflate to a few hundred bytes.
function png(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 1; // bit depth
  ihdr[9] = 0; // grayscale
  const row = Buffer.alloc(1 + Math.ceil(width / 8));
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Header-only JPEG: SOI, APP0, SOF0 with the size, EOI. Enough for magic-byte
// and dimension checks; it is never decoded.
function jpeg(width: number, height: number): Buffer {
  const sof = Buffer.alloc(17);
  sof.writeUInt16BE(17, 0);
  sof[2] = 8;
  sof.writeUInt16BE(height, 3);
  sof.writeUInt16BE(width, 5);
  sof[7] = 3;
  const app0 = Buffer.from([0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    app0,
    Buffer.from([0xff, 0xc0]),
    sof,
    Buffer.from([0xff, 0xd9]),
  ]);
}

const files = {
  png: join(dir, "a.png"),
  jpg: join(dir, "b.jpg"),
  small: join(dir, "small.png"),
  big: join(dir, "big.png"),
  text: join(dir, "notes.png"), // a text file with an image extension
  tinyPng: join(dir, "tiny.png"),
};
writeFileSync(files.png, png(512, 512));
writeFileSync(files.jpg, jpeg(640, 640));
writeFileSync(files.small, png(8, 8));
writeFileSync(files.big, png(4097, 512));
writeFileSync(files.text, "this is not an image");
writeFileSync(files.tinyPng, png(2, 2));

const opts = { prompt: "a tiger", s3Uri: "s3://bucket/out" };
const startFrame: KeyframeImage = { mediaType: "image/png", base64: "AAAA" };
const endFrame: KeyframeImage = { mediaType: "image/jpeg", base64: "BBBB" };

test("Luma body with no frames is the text-to-video body", () => {
  const expected = { prompt: "a tiger", aspect_ratio: "16:9", duration: "5s", resolution: "720p", loop: false };
  assert.deepEqual(buildLumaRayInput(opts, 5), expected);
  assert.equal(JSON.stringify(buildLumaRayInput(opts, 5, {})), JSON.stringify(expected));
  assert.equal(buildLumaRayInput(opts, 9).duration, "9s");
});

test("Luma body with a start frame sends frame0 only", () => {
  const body = buildLumaRayInput(opts, 5, { start: startFrame });
  assert.deepEqual(body.keyframes, {
    frame0: { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
  });
});

test("Luma body with an end frame sends frame1 only", () => {
  const body = buildLumaRayInput(opts, 5, { end: endFrame });
  assert.deepEqual(body.keyframes, {
    frame1: { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "BBBB" } },
  });
});

test("Luma body with both frames sends frame0 and frame1", () => {
  const body = buildLumaRayInput(opts, 5, { start: startFrame, end: endFrame });
  assert.deepEqual(Object.keys(body.keyframes as object), ["frame0", "frame1"]);
});

test("keyframe reader detects PNG and JPEG by content and returns base64", async () => {
  const p = await readKeyframeImage(files.png, "Start");
  assert.equal(p.mediaType, "image/png");
  assert.equal(p.base64, png(512, 512).toString("base64"));
  const j = await readKeyframeImage(files.jpg, "End");
  assert.equal(j.mediaType, "image/jpeg");
  assert.deepEqual(readJpegSize(jpeg(640, 480)), { width: 640, height: 480 });
});

test("keyframe reader refuses a non-image file, a missing file and out-of-range sizes", async () => {
  await assert.rejects(readKeyframeImage(files.text, "Start"), /not a PNG, JPEG or WebP image/);
  await assert.rejects(readKeyframeImage(join(dir, "missing.png"), "Start"), /ENOENT/);
  await assert.rejects(readKeyframeImage(files.small, "Start"), /at least 512x512/);
  await assert.rejects(readKeyframeImage(files.big, "End"), /at most 4096x4096/);
});

test("Titan body for text and for an image", () => {
  assert.deepEqual(buildTitanBody({ text: "hello" }), { inputText: "hello" });
  assert.deepEqual(buildTitanBody({ image: { mediaType: "image/png", base64: "AAAA" } }), { inputImage: "AAAA" });
});

test("Cohere body for text-only, image-only and mixed inputs", () => {
  const img = { image: { mediaType: "image/png" as const, base64: "AAAA" } };
  assert.deepEqual(buildCohereBody([{ text: "a" }, { text: "b" }]), {
    texts: ["a", "b"],
    input_type: "search_document",
  });
  assert.deepEqual(buildCohereBody([img, img]), {
    images: ["data:image/png;base64,AAAA", "data:image/png;base64,AAAA"],
    input_type: "search_document",
  });
  assert.deepEqual(buildCohereBody([{ text: "a" }, img]), {
    inputs: [
      { content: [{ type: "text", text: "a" }] },
      { content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] },
    ],
    input_type: "search_document",
  });
});

test("embedInputs refuses an image on a text-only model", async () => {
  await assert.rejects(
    embedInputs("titan-v2", [{ text: "a" }, { imagePath: files.tinyPng }]),
    /Titan Text Embeddings V2 embeds text only.*titan-multimodal, cohere/,
  );
  await assert.rejects(embedInputs("amazon.titan-embed-text-v2:0", [{ imagePath: files.tinyPng }]), /text only/);
});
