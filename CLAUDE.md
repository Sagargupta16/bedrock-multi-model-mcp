# CLAUDE.md

> This file stacks on top of the workspace root at `C:\Code\GitHub\`:
> - Root [`CLAUDE.md`](../../CLAUDE.md) -- voice, rules, routing map, references, skills, slash commands, conventions.
> - Root [`MEMORY.md`](../../MEMORY.md) -- live facts across repos.
> - Root [`STATUS.md`](../../STATUS.md) -- live PR/CI/security dashboard.
> - [`.claude/resources/`](../../.claude/resources/README.md) -- deep reference for collaboration, workflow, git, OSS, debugging, voice.
>
> Read those first. The guidance below only adds **repo-specific context** -- it does not override anything in the root.

## Project

MCP server exposing AWS Bedrock models (text, image, video, embeddings) as tools -- ask/compare Claude, Llama, Mistral, Nova, Qwen, DeepSeek, GPT-OSS and more from Claude Code or any MCP client.

Public OSS (MIT), published from `github.com/Sagargupta16/bedrock-multi-model-mcp`, consumed locally as the `bedrock` MCP server.

## Stack

- **Language**: TypeScript 6, ESM, Node >= 22
- **Framework**: `@modelcontextprotocol/sdk` (stdio transport) + `@aws-sdk/client-bedrock-runtime` v3, Zod v4 for data validation
- **Database**: none
- **Package manager**: npm (package-lock.json committed)
- **Deploy target**: local install / npm-publishable (`bin` -> `dist/index.js`)

## Run

```
npm install
npm run dev      # tsc --watch
npm run build    # tsc + copy src/data JSON into dist/data
npm start        # node dist/index.js (stdio MCP server)
```

## Test

```
npm run test     # builds, then node --test dist/**/*.test.js
npm run lint     # tsc --noEmit
```

- One suite: `src/models.test.ts`. Tests run against compiled `dist/`, so build first (`npm run test` handles it).

## Entry points

- `src/index.ts` -- MCP server: tool registration (bedrock_ask, bedrock_compare, bedrock_list_models, bedrock_generate_image, bedrock_generate_video, bedrock_video_status, bedrock_embed_similarity), stdio transport.

## Key files

- `src/data/*.json` -- model registries (text/image/video/embedding). Source of truth for the catalog; edit these to add/remove models, not code.
- `src/models.ts` -- loads + validates registry data, resolves aliases.
- `src/types.ts` -- Zod schemas the registries are validated against at load time.
- `src/bedrock/client.ts` -- shared region/auth config + raw HTTP bearer-token fallback.
- `src/bedrock/{converse,image,video,embed}.ts` -- per-modality API wrappers (Converse / InvokeModel / StartAsyncInvoke).

## Gotchas

- Build copies `src/data/` to `dist/data/` (`copy-data` script). Editing a registry JSON without rebuilding leaves the running server stale.
- Auth is dual-path: `AWS_BEARER_TOKEN_BEDROCK` (SDK >= 3.840.0 reads it natively) with a raw HTTP `Authorization: Bearer` fallback in `client.ts`, else the standard IAM credential chain.
- Regions split: text defaults to `AWS_REGION` (us-east-1); image (Stability) and video (Luma Ray 2) models live in us-west-2, and the video output S3 bucket must also be in us-west-2.
- Many foundation models require the `us.` cross-region inference profile prefix for on-demand invocation -- registries store the verified-working form per model. Keep only ACTIVE models (EOL entries like Nova Reel were purged).
- Generated images land in `BEDROCK_MCP_OUTPUT_DIR`, falling back to cwd then `~/bedrock-images`.
- CI is `.github/workflows/ci.yml`: `npm ci` + `npm run lint` + `npm test` on push to `main` and on every PR, across a Node matrix (22 and 24). Renovate is enabled via `renovate.json`.

## Repo-specific rules

- npm, not pnpm -- lockfile, scripts, and `prepublishOnly` flow are npm-based. Don't convert.

## Install              (CLI / tool)

- `npm install && npm run build`, then register in MCP settings: `node /path/to/dist/index.js` with `AWS_BEARER_TOKEN_BEDROCK` + `AWS_REGION` in `env`.

## Usage                (CLI / tool)

- `bedrock_ask` -- prompt one text model (alias or full model ID).
- `bedrock_compare` -- same prompt to 2-5 models side by side.
- `bedrock_generate_image` / `bedrock_generate_video` + `bedrock_video_status` -- media generation.
- `bedrock_embed_similarity` -- cosine-similarity matrix across 2+ texts.

## Config               (CLI / tool)

- No config file; env vars only: `AWS_REGION`, `AWS_BEARER_TOKEN_BEDROCK` (or IAM chain: `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_PROFILE`), `BEDROCK_MCP_OUTPUT_DIR`.
