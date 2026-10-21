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

- **Language**: TypeScript 7 (native `tsc`), ESM, Node >= 22
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

- Suites: `src/models.test.ts` (registries, measured `effort` / `structured_output` flags, server.json/package.json sync), `src/judge.test.ts` (bedrock_judge with an injected fake converse), `src/bedrock/converse.test.ts` (request building: outputConfig, option rejection, JSON reply parsing), `src/bedrock/client.test.ts` (bearer fallback rules). Tests run against compiled `dist/`, so build first (`npm run test` handles it).
- `npm run benchmark` makes live, billed Bedrock calls; `node scripts/benchmark.mjs --from docs/benchmark/results.json` only re-renders the table.

## Entry points

- `src/index.ts` -- MCP server: tool registration (bedrock_ask, bedrock_compare, bedrock_judge, bedrock_list_models, bedrock_generate_image, bedrock_generate_video, bedrock_video_status, bedrock_embed_similarity), stdio transport.
- `scripts/call-tool.mjs` -- stdio MCP client for smoke tests; `scripts/benchmark.mjs` -- latency benchmark that also rewrites the README block between `<!-- benchmark:start -->` and `<!-- benchmark:end -->` (do not hand-edit that block).

## Key files

- `src/data/*.json` -- model registries (text/image/video/embedding). Source of truth for the catalog; edit these to add/remove models, not code.
- `src/models.ts` -- loads + validates registry data, resolves aliases.
- `src/types.ts` -- Zod schemas the registries are validated against at load time.
- `src/bedrock/client.ts` -- shared region/auth config + `withBearerFallback` (raw HTTP retry on auth errors only).
- `src/judge.ts` -- bedrock_judge: shuffled blind labels, judge prompt, verdict parsing, report formatting.
- `server.json` + `.github/workflows/release.yml` -- MCP Registry metadata and the tag-triggered npm + registry publish (OIDC, no stored tokens).
- `src/bedrock/{converse,image,video,embed}.ts` -- per-modality API wrappers (Converse / InvokeModel / StartAsyncInvoke).

## Gotchas

- Build copies `src/data/` to `dist/data/` (`copy-data` script). Editing a registry JSON without rebuilding leaves the running server stale.
- Auth is dual-path: `AWS_BEARER_TOKEN_BEDROCK` (SDK >= 3.840.0 reads it natively) with a raw HTTP `Authorization: Bearer` fallback in `client.ts`, else the standard IAM credential chain. The fallback fires only on auth-rejection error names; never widen it to throttles or timeouts (a retried StartAsyncInvoke bills a second video).
- Version lives in three places: `package.json`, and `version` + `packages[0].version` in `server.json`. A test fails on skew.
- Regions split: text defaults to `AWS_REGION` (us-east-1); image (Stability) and video (Luma Ray 2) models live in us-west-2, and the video output S3 bucket must also be in us-west-2.
- Many foundation models require the `us.` cross-region inference profile prefix for on-demand invocation -- registries store the verified-working form per model. Keep only ACTIVE models (EOL entries like Nova Reel were purged).
- Structured output and effort both ride on Converse `outputConfig` (`textFormat` takes the schema as a JSON **string**; `effort` is a plain field). Registry flags `structured_output` and `effort` were measured per model on 2026-10-21; `buildConverseInput` rejects an unsupported option before the call, `effortFor` drops effort per model in compare/judge. GPT-OSS prefixes its JSON with a stray `B`, handled in `parseJsonReply`.
- Generated images land in `BEDROCK_MCP_OUTPUT_DIR`, falling back to cwd then `~/bedrock-images`.
- CI is `.github/workflows/ci.yml`: `npm ci --ignore-scripts` + `npm run lint` + `npm test` on push to `main` and on every PR, across a Node matrix (22, 24 and 26). Renovate is enabled via `renovate.json`.

## Repo-specific rules

- npm, not pnpm -- lockfile, scripts, and `prepublishOnly` flow are npm-based. Don't convert.

## Install              (CLI / tool)

- `npm install && npm run build`, then register in MCP settings: `node /path/to/dist/index.js` with `AWS_BEARER_TOKEN_BEDROCK` + `AWS_REGION` in `env`.

## Usage                (CLI / tool)

- `bedrock_ask` -- prompt one text model (alias or full model ID); `schema` for JSON output, `effort` for Claude thinking depth.
- `bedrock_compare` -- same prompt to 2-5 models side by side; takes `schema` and `effort`.
- `bedrock_judge` -- 2-5 models answer, a judge model (default claude-opus, Opus 5.5) scores them blind and picks a winner; the verdict uses structured output when the judge supports it.
- `bedrock_generate_image` / `bedrock_generate_video` + `bedrock_video_status` -- media generation.
- `bedrock_embed_similarity` -- cosine-similarity matrix across 2+ texts.

## Config               (CLI / tool)

- No config file; env vars only: `AWS_REGION`, `AWS_BEARER_TOKEN_BEDROCK` (or IAM chain: `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_PROFILE`), `BEDROCK_MCP_OUTPUT_DIR`.
