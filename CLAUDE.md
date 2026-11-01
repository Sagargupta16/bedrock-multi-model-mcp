# CLAUDE.md

> This file stacks on top of the workspace root at `C:\Code\GitHub\`:
> - Root [`CLAUDE.md`](../../CLAUDE.md) -- voice, rules, routing map, references, skills, slash commands, conventions.
> - Root [`MEMORY.md`](../../MEMORY.md) -- live facts across repos.
> - Root [`STATUS.md`](../../STATUS.md) -- live PR/CI/security dashboard.
> - [`.claude/resources/`](../../.claude/resources/README.md) -- deep reference for collaboration, workflow, git, OSS, debugging, voice.
>
> Read those first. The guidance below only adds **repo-specific context** -- it does not override anything in the root.

## Project

MCP server exposing AWS Bedrock models (text, image, video, embeddings) as tools -- ask/compare Claude, GPT, Grok, Kimi, Mistral, Nova, Qwen, DeepSeek and more from Claude Code or any MCP client.

Public OSS (MIT), published from `github.com/Sagargupta16/bedrock-multi-model-mcp`, consumed locally as the `bedrock` MCP server.

## Stack

- **Language**: TypeScript 7 (native `tsc`), ESM, Node >= 22
- **Framework**: `@modelcontextprotocol/sdk` (stdio transport) + `@aws-sdk/client-bedrock-runtime` v3, Zod v4 for data validation
- **Database**: none
- **Package manager**: npm (package-lock.json committed)
- **Deploy target**: npm `bedrock-multi-model-mcp` (`bin` -> `dist/index.js`, run with `npx -y`) and the MCP Registry, both published by `release.yml` on a `v*` tag

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

- Suites: `src/models.test.ts` (registries, measured `effort` / `structured_output` flags, server.json/package.json sync), `src/judge.test.ts` (bedrock_judge with an injected fake converse), `src/bedrock/converse.test.ts` (request building: outputConfig, option rejection, JSON reply parsing). Tests run against compiled `dist/`, so build first (`npm run test` handles it). `tsc` never deletes outputs, so after removing a source file run `npm run clean` or a stale `dist/*.test.js` keeps running.
- `npm run benchmark` makes live, billed Bedrock calls; `node scripts/benchmark.mjs --from docs/benchmark/results.json` only re-renders the table.
- `npm run lifecycle` checks every registry id against AWS's public Legacy/EOL page (no credentials, no billing).

## Entry points

- `src/index.ts` -- MCP server: tool registration (bedrock_ask, bedrock_compare, bedrock_judge, bedrock_list_models, bedrock_generate_image, bedrock_edit_image, bedrock_generate_video, bedrock_video_status, bedrock_embed_similarity), stdio transport.
- `scripts/call-tool.mjs` -- stdio MCP client for smoke tests; `scripts/benchmark.mjs` -- latency benchmark that also rewrites the README block between `<!-- benchmark:start -->` and `<!-- benchmark:end -->` (do not hand-edit that block).

## Key files

- `src/data/*.json` -- model registries (text/image/image-edit/video/embedding). Source of truth for the catalog; edit these to add/remove models, not code. `image-edit-models.json` also declares each Stability edit service's required and optional body fields, which `buildEditBody` in `src/bedrock/edit.ts` enforces before the call.
- `src/models.ts` -- loads + validates registry data, resolves aliases.
- `src/types.ts` -- Zod schemas the registries are validated against at load time.
- `src/bedrock/client.ts` -- shared region/auth config, one cached SDK client per region, and the empty-bearer-token guard.
- `scripts/check-lifecycle.mjs` + `.github/workflows/lifecycle.yml` -- weekly (and on registry PRs) check that no registry model is Legacy or EOL on AWS.
- `src/judge.ts` -- bedrock_judge: shuffled blind labels, judge prompt, verdict parsing, report formatting.
- `server.json` + `.github/workflows/release.yml` -- MCP Registry metadata and the tag-triggered npm + registry publish (OIDC, no stored tokens). The npm step skips a version npm already has, and a read-only step waits until npm serves the version before `mcp-publisher publish` (the registry rejected v0.7.1 two seconds after npm publish).
- `src/bedrock/{converse,image,edit,video,embed}.ts` -- per-modality API wrappers (Converse / InvokeModel / StartAsyncInvoke). `image.ts` exports `firstImage` and `saveImage`, shared with `edit.ts`.
- `src/bedrock/mantle.ts` -- bedrock-mantle Chat Completions for text entries with `"api": "mantle"` (Gemma 4); `converse()` dispatches to it after `buildConverseInput`.

## Gotchas

- Build copies `src/data/` to `dist/data/` (`copy-data` script). Editing a registry JSON without rebuilding leaves the running server stale.
- Auth is the SDK's alone: it picks bearer auth whenever `AWS_BEARER_TOKEN_BEDROCK` exists (even empty, which then fails every call with "the `token` is not defined", so `client.ts` deletes an empty value at startup), else the standard IAM credential chain. The raw-HTTP bearer retry was removed in 0.7.0: it resent the same token the SDK had just sent, so it could never succeed. Don't add retries around `StartAsyncInvoke` (a retry bills a second video).
- Every tool passes the MCP request's `extra.signal` to `client.send(..., { abortSignal })`, except `startVideoGeneration`: a start cancelled after it was sent can leave a billed job with no ARN.
- Version lives in three places: `package.json`, and `version` + `packages[0].version` in `server.json`. A test fails on skew.
- Regions split: text defaults to `AWS_REGION` (us-east-1); image (Stability) and video (Luma Ray 2) models live in us-west-2, and the video output S3 bucket must also be in us-west-2.
- Many foundation models require the `us.` cross-region inference profile prefix for on-demand invocation -- registries store the verified-working form per model. Keep only ACTIVE models: Legacy entries go too, because AWS blocks new customers from them (the five that went Legacy on 2026-09-30 left in 0.7.0). `npm run lifecycle` catches new listings.
- Structured output and effort both ride on Converse `outputConfig` (`textFormat` takes the schema as a JSON **string**; `effort` is a plain field). Registry flags `structured_output`, `effort` and `noTemperature` were measured per model on 2026-10-21, and on 2026-11-01 for the models added in 0.7.0; `buildConverseInput` rejects an unsupported option before the call, `effortFor` drops effort per model in compare/judge. A model can accept `textFormat` and ignore it (Magistral Small did), so check the reply matches the schema before flagging it. GPT-OSS prefixes its JSON with a stray `B`, handled in `parseJsonReply`.
- bedrock-mantle (Gemma 4): Chat Completions under `/openai/v1`, not `/v1`; bearer token only here (AWS takes SigV4 too, not wired); `reasoning_effort` stops at `xhigh` (`max` is a 400); a reasoning model can spend a small `max_tokens` on thinking and return empty content with `finish_reason: length` (Grok 4.3 did at 256). Claude models stay on Converse.
- Stability edit services (`bedrock_edit_image`) are on the `us.stability.*` profile only; the three upscalers default to webp because their 4x PNG is over the 16 MB InvokeModel response limit; Fast and Creative Upscale take at most 1,048,576 input pixels.
- Cohere Embed v4 returns `embeddings` keyed by type (`{ float: [...] }`) even when no type is requested; v3 returned a bare array. `embed.ts` handles both.
- Generated images land in `BEDROCK_MCP_OUTPUT_DIR`, falling back to cwd then `~/bedrock-images`.
- CI is `.github/workflows/ci.yml`: `npm ci --ignore-scripts` + `npm run lint` + `npm test` on push to `main` and on every PR, across a Node matrix (22, 24 and 26). `.github/workflows/lifecycle.yml` runs `scripts/check-lifecycle.mjs` weekly and on PRs that touch `src/data/`. Renovate is enabled via `renovate.json`.

## Repo-specific rules

- npm, not pnpm -- lockfile, scripts, and `prepublishOnly` flow are npm-based. Don't convert.

## Install              (CLI / tool)

- Published on npm since 0.7.0: register `npx -y bedrock-multi-model-mcp` in MCP settings with `AWS_BEARER_TOKEN_BEDROCK` + `AWS_REGION` in `env`. From source: `npm install && npm run build`, then `node /path/to/dist/index.js`.

## Usage                (CLI / tool)

- `bedrock_ask` -- prompt one text model (alias or full model ID); `schema` for JSON output, `effort` for thinking depth (Claude, GPT-6.1, Grok 4.7, Kimi K3, Gemma 4).
- `bedrock_compare` -- same prompt to 2-5 models side by side; takes `schema` and `effort`.
- `bedrock_judge` -- 2-5 models answer, a judge model (default claude-opus, Opus 5.5) scores them blind and picks a winner; the verdict uses structured output when the judge supports it.
- `bedrock_generate_image` / `bedrock_generate_video` + `bedrock_video_status` -- media generation.
- `bedrock_edit_image` -- one of 13 Stability image services on a local image (`operation`, `image_path`); the edit services are only on the `us.stability.*` profile.
- `bedrock_embed_similarity` -- cosine-similarity matrix across 2+ texts.

## Config               (CLI / tool)

- No config file; env vars only: `AWS_REGION`, `AWS_BEARER_TOKEN_BEDROCK` (or IAM chain: `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_PROFILE`), `BEDROCK_MCP_OUTPUT_DIR`.
