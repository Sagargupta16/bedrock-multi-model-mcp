import { realpathSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 262144;
export const MAX_TOTAL_BYTES = 1048576;

export interface LoadedFile {
  path: string;
  bytes: number;
  text: string;
}

export interface LoadOptions {
  root?: string;
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

const SECRET_NAMES = new Set([
  ".npmrc",
  ".netrc",
  ".pgpass",
  ".pypirc",
  ".envrc",
  ".dev.vars",
  ".git-credentials",
  "credentials",
]);
const SECRET_EXTENSIONS = new Set([
  ".pem",
  ".key",
  ".pfx",
  ".p12",
  ".keystore",
  ".jks",
  ".ppk",
  ".tfstate",
  ".tfvars",
]);
const SECRET_FOLDERS = new Set([".ssh", ".aws", ".kube", ".docker", ".gnupg"]);

// UNC and device paths (\\host\share, //host/share, \\?\, \\.\). Opening one on
// Windows makes an SMB connection that offers the user's credentials to the named
// host, so callers refuse them before any file call.
export function isNetworkPath(p: string): boolean {
  return /^[\\/]{2}/.test(p);
}

function isInside(root: string, target: string): boolean {
  const fold = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);
  const rel = path.relative(fold(root), fold(target));
  return rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
}

// A home folder, any folder above it, or a drive root: too much to hand to a
// model by default.
function isBroadRoot(dir: string): boolean {
  if (path.parse(dir).root === dir) return true;
  try {
    return isInside(dir, realpathSync(os.homedir()));
  } catch {
    return false;
  }
}

/**
 * The folder files may be read from (real path): BEDROCK_MCP_FILES_ROOT, else the
 * working folder. The working folder is the project under Claude Code, but a
 * desktop client can start the server in the home folder, so that fallback is
 * refused when it is a home folder or a drive root.
 */
export function filesRoot(): string {
  const env = process.env.BEDROCK_MCP_FILES_ROOT?.trim();
  // An MCPB host can pass an unset optional field as the literal "${user_config...}".
  if (env && !env.startsWith("${")) return realpathSync(env);
  const cwd = realpathSync(process.cwd());
  if (isBroadRoot(cwd)) {
    throw new Error(
      `File input is off: the server's working folder (${cwd}) is a home folder or a drive root. ` +
        "Set BEDROCK_MCP_FILES_ROOT to the project folder files may be read from.",
    );
  }
  return cwd;
}

function looksSecret(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === ".env" ||
    lower.startsWith(".env.") ||
    SECRET_NAMES.has(lower) ||
    SECRET_EXTENSIONS.has(path.extname(lower)) ||
    // SSH private keys (id_rsa, id_ed25519_work); the .pub half has an extension.
    /^id_[a-z0-9_-]+$/.test(lower)
  );
}

// The name filter is a second layer behind the root check, not the boundary.
function isSecretPath(root: string, target: string): boolean {
  const parts = path.relative(root, target).toLowerCase().split(path.sep);
  return looksSecret(parts[parts.length - 1]) || parts.slice(0, -1).some((part) => SECRET_FOLDERS.has(part));
}

/** Read local text files for a prompt. Any refusal fails the whole call. */
export async function loadFiles(paths: string[], options: LoadOptions = {}): Promise<LoadedFile[]> {
  const maxFiles = options.maxFiles ?? MAX_FILES;
  const maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? MAX_TOTAL_BYTES;

  if (paths.length > maxFiles) {
    throw new Error(`Too many files: ${paths.length} given, the limit is ${maxFiles} files`);
  }

  const root = await realpath(options.root ?? filesRoot());
  const seen = new Set<string>();
  const loaded: LoadedFile[] = [];
  let total = 0;

  for (const given of paths) {
    if (isNetworkPath(given)) throw new Error(`${given}: network and device paths are refused`);
    const full = path.resolve(root, given);
    // Checked on the path as written, before any file call: a path outside the
    // root is never opened, and the answer does not say whether it exists.
    if (!isInside(root, full)) {
      throw new Error(`${given}: outside the allowed root folder ${root}`);
    }
    if (isSecretPath(root, full)) {
      throw new Error(`${given}: refused, the name looks like a secret store`);
    }
    let real: string;
    try {
      real = await realpath(full);
    } catch {
      throw new Error(`${given}: file does not exist`);
    }
    // Checked again on the real path, so a symlink or junction cannot escape.
    if (!isInside(root, real)) {
      throw new Error(`${given}: outside the allowed root folder ${root}`);
    }
    if (isSecretPath(root, real)) {
      throw new Error(`${given}: refused, the name looks like a secret store`);
    }
    if (seen.has(real)) continue;
    seen.add(real);

    const info = await stat(real);
    if (!info.isFile()) throw new Error(`${given}: not a regular file`);
    if (info.size > maxFileBytes) {
      throw new Error(`${given}: ${info.size} bytes is over the per-file limit of ${maxFileBytes} bytes`);
    }
    if (total + info.size > maxTotalBytes) {
      throw new Error(`${given}: would pass the total limit of ${maxTotalBytes} bytes`);
    }

    const buf = await readFile(real);
    if (buf.length > maxFileBytes) {
      throw new Error(`${given}: ${buf.length} bytes is over the per-file limit of ${maxFileBytes} bytes`);
    }
    total += buf.length;
    if (total > maxTotalBytes) {
      throw new Error(`${given}: would pass the total limit of ${maxTotalBytes} bytes`);
    }
    if (buf.includes(0)) throw new Error(`${given}: not a text file (contains a NUL byte)`);
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
      throw new Error(`${given}: not a text file (invalid UTF-8)`);
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

    loaded.push({ path: path.relative(root, real).split(path.sep).join("/"), bytes: buf.length, text });
  }
  return loaded;
}

/** Append the files to a prompt as fenced blocks. */
export function withFiles(prompt: string, files: LoadedFile[]): string {
  if (files.length === 0) return prompt;
  const blocks = files.map((f) => {
    let tag = "file";
    for (let n = 2; f.text.includes(`</${tag}>`); n++) tag = `file-${n}`;
    return `<${tag} path="${f.path}">\n${f.text}\n</${tag}>`;
  });
  return `${prompt}\n\n${blocks.join("\n")}`;
}

/** One sentence for a tool description. */
export function filesHelp(): string {
  return (
    `Optional local text files to include in the prompt, read only from under the root folder ` +
    `(env BEDROCK_MCP_FILES_ROOT, default the server's working folder unless that is a home folder or a drive root): ` +
    `up to ${MAX_FILES} files, ${MAX_FILE_BYTES / 1024} KB each and ${MAX_TOTAL_BYTES / 1048576} MB in total, ` +
    `secret-looking files such as .env and keys and network paths are refused, and the content is sent to the model provider.`
  );
}
