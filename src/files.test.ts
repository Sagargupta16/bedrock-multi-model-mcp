import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { filesHelp, filesRoot, isNetworkPath, loadFiles, withFiles } from "./files.js";

function tmp(): { dir: string; root: string; done: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bmm-files-"));
  const root = path.join(dir, "root");
  fs.mkdirSync(root);
  return { dir, root, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("loads a normal file with a relative forward-slash path", async () => {
  const t = tmp();
  try {
    fs.mkdirSync(path.join(t.root, "sub"));
    fs.writeFileSync(path.join(t.root, "sub", "a.txt"), "hello");
    const out = await loadFiles(["sub/a.txt"], { root: t.root });
    assert.deepEqual(out, [{ path: "sub/a.txt", bytes: 5, text: "hello" }]);
  } finally {
    t.done();
  }
});

test("loads an absolute path inside the root, strips a BOM, reads duplicates once", async () => {
  const t = tmp();
  try {
    const file = path.join(t.root, "a.txt");
    fs.writeFileSync(file, "\uFEFFhi");
    const out = await loadFiles([file, "a.txt"], { root: t.root });
    assert.equal(out.length, 1);
    assert.equal(out[0].text, "hi");
  } finally {
    t.done();
  }
});

test("refuses ../outside.txt and an absolute path outside the root", async () => {
  const t = tmp();
  try {
    const outside = path.join(t.dir, "outside.txt");
    fs.writeFileSync(outside, "x");
    await assert.rejects(loadFiles(["../outside.txt"], { root: t.root }), /outside the allowed root/);
    await assert.rejects(loadFiles([outside], { root: t.root }), /outside the allowed root/);
  } finally {
    t.done();
  }
});

test("refuses a symlink that points outside the root", async (c) => {
  const t = tmp();
  try {
    const outside = path.join(t.dir, "outside.txt");
    fs.writeFileSync(outside, "x");
    try {
      fs.symlinkSync(outside, path.join(t.root, "link.txt"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EPERM") {
        c.skip("symlink creation not permitted");
        return;
      }
      throw e;
    }
    await assert.rejects(loadFiles(["link.txt"], { root: t.root }), /outside the allowed root/);
  } finally {
    t.done();
  }
});

test("refuses binary, invalid UTF-8, oversize and missing files", async () => {
  const t = tmp();
  try {
    fs.writeFileSync(path.join(t.root, "bin.dat"), Buffer.from([65, 0, 66]));
    fs.writeFileSync(path.join(t.root, "bad.txt"), Buffer.from([0xff, 0xfe, 0x41]));
    fs.writeFileSync(path.join(t.root, "big.txt"), "x".repeat(101));
    await assert.rejects(loadFiles(["bin.dat"], { root: t.root }), /NUL byte/);
    await assert.rejects(loadFiles(["bad.txt"], { root: t.root }), /invalid UTF-8/);
    await assert.rejects(loadFiles(["big.txt"], { root: t.root, maxFileBytes: 100 }), /per-file limit of 100 bytes/);
    await assert.rejects(loadFiles(["nope.txt"], { root: t.root }), /does not exist/);
  } finally {
    t.done();
  }
});

test("enforces the total cap and the file count", async () => {
  const t = tmp();
  try {
    for (const n of ["a", "b", "c"]) fs.writeFileSync(path.join(t.root, `${n}.txt`), "x".repeat(60));
    await assert.rejects(
      loadFiles(["a.txt", "b.txt"], { root: t.root, maxTotalBytes: 100 }),
      /total limit of 100 bytes/,
    );
    await assert.rejects(
      loadFiles(["a.txt", "b.txt", "c.txt"], { root: t.root, maxFiles: 2 }),
      /limit is 2 files/,
    );
  } finally {
    t.done();
  }
});

test("refuses secret-looking names and directories", async () => {
  const t = tmp();
  try {
    fs.writeFileSync(path.join(t.root, ".env"), "A=1");
    fs.writeFileSync(path.join(t.root, ".env.local"), "A=1");
    fs.writeFileSync(path.join(t.root, "key.pem"), "x");
    fs.mkdirSync(path.join(t.root, "dir"));
    await assert.rejects(loadFiles([".env"], { root: t.root }), /secret/);
    await assert.rejects(loadFiles([".env.local"], { root: t.root }), /secret/);
    await assert.rejects(loadFiles(["key.pem"], { root: t.root }), /secret/);
    await assert.rejects(loadFiles(["dir"], { root: t.root }), /not a regular file/);
  } finally {
    t.done();
  }
});

test("refuses network and device paths before touching the disk", async () => {
  const t = tmp();
  try {
    for (const p of ["\\\\host\\share\\a.txt", "//host/share/a.txt", "\\\\?\\C:\\a.txt", "\\\\.\\C:\\a.txt"]) {
      assert.equal(isNetworkPath(p), true);
      await assert.rejects(loadFiles([p], { root: t.root }), /network and device paths are refused/);
    }
    assert.equal(isNetworkPath("sub/a.txt"), false);
    assert.equal(isNetworkPath("/tmp/a.txt"), false);
  } finally {
    t.done();
  }
});

test("a path outside the root gets the same answer whether or not it exists", async () => {
  const t = tmp();
  try {
    fs.writeFileSync(path.join(t.dir, "real.txt"), "x");
    await assert.rejects(loadFiles(["../real.txt"], { root: t.root }), /outside the allowed root/);
    await assert.rejects(loadFiles(["../missing.txt"], { root: t.root }), /outside the allowed root/);
  } finally {
    t.done();
  }
});

test("refuses credential stores by name and by folder", async () => {
  const t = tmp();
  try {
    fs.mkdirSync(path.join(t.root, ".ssh"));
    fs.mkdirSync(path.join(t.root, ".aws", "sso"), { recursive: true });
    const names = [".git-credentials", ".envrc", ".dev.vars", ".pypirc", "prod.tfstate", "prod.tfvars", "key.ppk", "id_rsa_work", ".ssh/config", ".aws/sso/cache.json"];
    for (const name of names) {
      fs.writeFileSync(path.join(t.root, name), "x");
      await assert.rejects(loadFiles([name], { root: t.root }), /looks like a secret store/, name);
    }
    // The public half of a key pair and ordinary files still load.
    fs.writeFileSync(path.join(t.root, "id_rsa.pub"), "ssh-rsa AAAA");
    fs.writeFileSync(path.join(t.root, "identity.md"), "notes");
    assert.equal((await loadFiles(["id_rsa.pub", "identity.md"], { root: t.root })).length, 2);
  } finally {
    t.done();
  }
});

test("filesRoot uses the env folder, ignores an unreplaced placeholder, and refuses a home folder", () => {
  const t = tmp();
  const saved = process.env.BEDROCK_MCP_FILES_ROOT;
  const cwd = process.cwd();
  try {
    process.env.BEDROCK_MCP_FILES_ROOT = t.root;
    assert.equal(filesRoot(), fs.realpathSync(t.root));

    // Unset, empty and an MCPB placeholder all fall back to the working folder.
    process.chdir(t.root);
    for (const value of [undefined, "", "${user_config.BEDROCK_MCP_FILES_ROOT}"]) {
      if (value === undefined) delete process.env.BEDROCK_MCP_FILES_ROOT;
      else process.env.BEDROCK_MCP_FILES_ROOT = value;
      assert.equal(filesRoot(), fs.realpathSync(t.root));
    }

    process.chdir(os.homedir());
    assert.throws(() => filesRoot(), /File input is off/);
    process.chdir(path.parse(os.homedir()).root);
    assert.throws(() => filesRoot(), /File input is off/);
  } finally {
    process.chdir(cwd);
    if (saved === undefined) delete process.env.BEDROCK_MCP_FILES_ROOT;
    else process.env.BEDROCK_MCP_FILES_ROOT = saved;
    t.done();
  }
});

test("withFiles formats zero, one and two files", () => {
  assert.equal(withFiles("p", []), "p");
  assert.equal(withFiles("p", [{ path: "a.txt", bytes: 1, text: "A" }]), 'p\n\n<file path="a.txt">\nA\n</file>');
  assert.equal(
    withFiles("p", [
      { path: "a.txt", bytes: 1, text: "A" },
      { path: "b/c.txt", bytes: 1, text: "B" },
    ]),
    'p\n\n<file path="a.txt">\nA\n</file>\n<file path="b/c.txt">\nB\n</file>',
  );
});

test("withFiles picks a fence tag the text does not contain", () => {
  const text = "x </file> y </file-2> z";
  const out = withFiles("p", [{ path: "a.txt", bytes: text.length, text }]);
  assert.equal(out, `p\n\n<file-3 path="a.txt">\n${text}\n</file-3>`);
});

test("filesHelp names the env var and the limits", () => {
  const help = filesHelp();
  assert.match(help, /BEDROCK_MCP_FILES_ROOT/);
  assert.match(help, /10 files/);
  assert.match(help, /256 KB/);
  assert.match(help, /1 MB/);
});
