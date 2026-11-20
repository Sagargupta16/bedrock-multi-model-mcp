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

- Suites: `src/models.test.ts` (registries, measured `effort` / `structured_output` flags, server.json/package.json sync), `src/judge.test.ts` (bedrock_judge with an injected fake converse), `src/panel.test.ts` (bedrock_panel: role and seat resolution, each model's view, failed turns, with an injected fake converse), `src/bedrock/converse.test.ts` (request building: outputConfig, option rejection, JSON reply parsing), `src/doctor.test.ts` (bedrock_doctor status classes), `src/files.test.ts` (the `files` root, limits and refusals), `src/cost.test.ts` (estimates and totals), `src/prompts.test.ts` (MCP prompts), `src/conversation.test.ts` (conversation store limits and expiry) and `src/bedrock/media.test.ts` (Luma keyframe bodies, image reader, Titan and Cohere embed bodies). Tests run against compiled `dist/`, so build first (`npm run test` handles it). `tsc` never deletes outputs, so after removing a source file run `npm run clean` or a stale `dist/*.test.js` keeps running.
- `npm run benchmark` makes live, billed Bedrock calls; `node scripts/benchmark.mjs --from docs/benchmark/results.json` only re-renders the table.
- `npm run lifecycle` checks every registry id against AWS's public Legacy/EOL page (no credentials, no billing).
- `npm run new-models` lists Bedrock model cards that are neither in the catalog nor in `scripts/model-skips.json` (reads AWS docs pages, no credentials, no billing; exit 2 when the index or over 10 percent of the cards failed to fetch). `npm run pack:mcpb` builds, then writes `bedrock-multi-model-mcp-<version>.mcpb` into the repo root (gitignored).

## Entry points

- `src/index.ts` -- MCP server: tool registration (bedrock_ask, bedrock_compare, bedrock_judge, bedrock_panel, bedrock_list_models, bedrock_doctor, bedrock_generate_image, bedrock_edit_image, bedrock_generate_video, bedrock_video_status, bedrock_embed_similarity; 11 tools) and the MCP prompts via `registerPrompts`, stdio transport.
- `scripts/call-tool.mjs` -- stdio MCP client for smoke tests; `scripts/benchmark.mjs` -- latency benchmark that also rewrites the README block between `<!-- benchmark:start -->` and `<!-- benchmark:end -->` (do not hand-edit that block).

## Key files

- `src/data/*.json` -- model registries (text/image/image-edit/video/embedding). Source of truth for the catalog; edit these to add/remove models, not code. `image-edit-models.json` also declares each Stability edit service's required and optional body fields, which `buildEditBody` in `src/bedrock/edit.ts` enforces before the call.
- `src/models.ts` -- loads + validates registry data, resolves aliases.
- `src/types.ts` -- Zod schemas the registries are validated against at load time.
- `src/bedrock/client.ts` -- shared region/auth config, one cached SDK client per region, and the empty-bearer-token guard.
- `scripts/check-lifecycle.mjs` + `.github/workflows/lifecycle.yml` -- weekly (and on registry PRs) check that no registry model is Legacy or EOL on AWS.
- `src/judge.ts` -- bedrock_judge: shuffled blind labels, judge prompt, verdict parsing, report formatting.
- `src/panel.ts` -- bedrock_panel: role presets, the three `level` panels (aliases, checked against the registry by `panel.test.ts`), each model's single-message view of the discussion, sequential rounds, optional moderator summary. `converse()` takes one prompt string, so own turns are marked `(you)` inside the user message instead of being assistant turns.
- `server.json` + `.github/workflows/release.yml` -- MCP Registry metadata and the tag-triggered npm + registry publish (OIDC, no stored tokens). The npm step skips a version npm already has, and a read-only step waits until npm serves the version before `mcp-publisher publish` (the registry rejected v0.7.1 two seconds after npm publish).
- `src/bedrock/{converse,image,edit,video,embed}.ts` -- per-modality API wrappers (Converse / InvokeModel / StartAsyncInvoke). `image.ts` exports `firstImage` and `saveImage`, shared with `edit.ts`.
- `src/doctor.ts` -- bedrock_doctor: one 32-token call per text model (concurrency 1-8, default 4), `classifyError` maps the SDK error to ok / throttled / denied / invalid / error.
- `src/files.ts` -- the `files` option (`loadFiles`, `withFiles`): root, caps and refusals, shared by ask, compare, judge and panel through `attachFiles` in `src/index.ts`.
- `src/cost.ts` -- `estimateCost` / `formatCost` from the registry `price`; `costTotal` in `src/panel.ts` sums a reply's calls.
- `src/conversation.ts` -- `conversations`, the in-memory store behind `conversation_id` on bedrock_ask.
- `src/prompts.ts` -- MCP prompts `second-opinion`, `compare-models`, `panel-discussion`.
- `src/panel.ts` also holds `LEVELS`, `pickModels` and `pickModel`, which `level` on ask, compare and judge goes through.
- `scripts/check-new-models.mjs` + `scripts/model-skips.json` -- the new-model watcher; a card is matched by slug, then ids, then name.
- `scripts/pack-mcpb.mjs` + `mcpb/manifest.json` -- the `.mcpb` bundle (dist without tests, production `node_modules`, a manifest stamped with the `package.json` version).
- `src/bedrock/mantle.ts` -- bedrock-mantle Chat Completions for text entries with `"api": "mantle"` (Gemma 4); `converse()` dispatches to it after `buildConverseInput`.

## Gotchas

- Build copies `src/data/` to `dist/data/` (`copy-data` script). Editing a registry JSON without rebuilding leaves the running server stale.
- Auth is the SDK's alone: it picks bearer auth whenever `AWS_BEARER_TOKEN_BEDROCK` exists (even empty, which then fails every call with "the `token` is not defined", so `client.ts` deletes an empty value at startup), else the standard IAM credential chain. Since 0.8.1, on Windows an empty or missing key is first read from the user environment (`reg query HKCU\Environment`): the Claude desktop app does not pass the user's `AWS_BEARER_TOKEN_BEDROCK` to the servers it starts, so a config with `"${AWS_BEARER_TOKEN_BEDROCK}"` arrives empty. The value is never logged. The raw-HTTP bearer retry was removed in 0.7.0: it resent the same token the SDK had just sent, so it could never succeed. Don't add retries around `StartAsyncInvoke` (a retry bills a second video).
- Every tool passes the MCP request's `extra.signal` to `client.send(..., { abortSignal })`, except `startVideoGeneration`: a start cancelled after it was sent can leave a billed job with no ARN.
- Version lives in three places: `package.json`, and `version` + `packages[0].version` in `server.json`. A test fails on skew.
- Regions split: text defaults to `AWS_REGION` (us-east-1); image (Stability) and video (Luma Ray 2) models live in us-west-2, and the video output S3 bucket must also be in us-west-2.
- Many foundation models require the `us.` cross-region inference profile prefix for on-demand invocation -- registries store the verified-working form per model. Keep only ACTIVE models: Legacy entries go too, because AWS blocks new customers from them (the five that went Legacy on 2026-09-30 left in 0.7.0). `npm run lifecycle` catches new listings.
- Structured output and effort both ride on Converse `outputConfig` (`textFormat` takes the schema as a JSON **string**; `effort` is a plain field). Registry flags `structured_output`, `effort` and `noTemperature` were measured per model on 2026-10-21, and on 2026-11-01 for the models added in 0.7.0; `buildConverseInput` rejects an unsupported option before the call, `effortFor` drops effort per model in compare/judge. A model can accept `textFormat` and ignore it (Magistral Small did), so check the reply matches the schema before flagging it. GPT-OSS prefixes its JSON with a stray `B`, handled in `parseJsonReply`.
- bedrock-mantle (Gemma 4): Chat Completions under `/openai/v1`, not `/v1`; bearer token only here (AWS takes SigV4 too, not wired); `reasoning_effort` stops at `xhigh` (`max` is a 400); a reasoning model can spend a small `max_tokens` on thinking and return empty content with `finish_reason: length` (Grok 4.3 did at 256). Claude models stay on Converse.
- Stability edit services (`bedrock_edit_image`) are on the `us.stability.*` profile only; the three upscalers default to webp because their 4x PNG is over the 16 MB InvokeModel response limit; Fast and Creative Upscale take at most 1,048,576 input pixels.
- Cohere Embed v4 returns `embeddings` keyed by type (`{ float: [...] }`) even when no type is requested; v3 returned a bare array. `embed.ts` handles both.
- Generated images land in `BEDROCK_MCP_OUTPUT_DIR`, falling back to cwd then `~/bedrock-images`.
- Prices: the optional `price` on each `text-models.json` entry (USD per 1M input and output tokens) comes from the AWS Price List bulk files for us-east-1 (`AmazonBedrockFoundationModels` and `AmazonBedrock` offers), read 2026-11-20, on-demand standard tier. `us.` ids use the non-global price (AWS lists a global one about 10 percent lower). No cache, batch or long-context pricing, so every figure shown is an estimate.
- `files` reads only under `BEDROCK_MCP_FILES_ROOT` (default the working folder, resolved through symlinks), at most 10 files, 256 KB each, 1 MB total; secret-looking names (`.env*`, `.npmrc`, `.netrc`, `.pgpass`, `.pypirc`, `.envrc`, `.dev.vars`, `.git-credentials`, `credentials`, `id_*` with no extension, `.pem` / `.key` / `.pfx` / `.p12` / `.keystore` / `.jks` / `.ppk` / `.tfstate` / `.tfvars`, anything under `.ssh` / `.aws` / `.kube` / `.docker` / `.gnupg`), non-regular files, NUL bytes and invalid UTF-8 are refused, and one refusal fails the call before any billed call. The content goes to the model provider. Three rules from the 2026-11-20 security review, keep them: the unset-root fallback throws when the working folder is a home folder or a drive root (a desktop client can start the server there); the root check runs on the path as written BEFORE any file call and again on the real path; UNC and device paths (`\\host\share`, `\\?\`) are refused first by `isNetworkPath`, in `loadFiles` and in `readImageFile` (opening one on Windows offers the user's NTLM credentials to that host). `readImageFile` also stats first and refuses files over 25 MB.
- Conversations (`conversation_id`) are in process memory only: 30 minute TTL after the last turn (checked lazily, no timers), 20 turns, 50 conversations, 200,000 characters per conversation. A turn with an empty reply or over the cap is not kept.
- `.github/workflows/lifecycle.yml` has a second job, `new-models` (schedule and manual runs only, `issues: write`): it runs `scripts/check-new-models.mjs --json` and opens or updates one issue titled "New Bedrock model cards not in the catalog". `release.yml` has a `bundle` job after `publish` (`contents: write`) that runs `scripts/pack-mcpb.mjs` and attaches the `.mcpb` to the GitHub release.
- The bundle version is stamped from `package.json` at pack time: `mcpb/manifest.json` carries `"version": "0.0.0"` on purpose, so do not edit it by hand and do not count it as a fourth place a version lives.
- CI is `.github/workflows/ci.yml`: `npm ci --ignore-scripts` + `npm run lint` + `npm test` on push to `main` and on every PR, across a Node matrix (22, 24 and 26). `.github/workflows/lifecycle.yml` runs `scripts/check-lifecycle.mjs` weekly and on PRs that touch `src/data/`. Renovate is enabled via `renovate.json`.

## Repo-specific rules

- npm, not pnpm -- lockfile, scripts, and `prepublishOnly` flow are npm-based. Don't convert.

## Install              (CLI / tool)

- Published on npm since 0.7.0: register `npx -y bedrock-multi-model-mcp` in MCP settings with `AWS_BEARER_TOKEN_BEDROCK` + `AWS_REGION` in `env`. From source: `npm install && npm run build`, then `node /path/to/dist/index.js`.

## Usage                (CLI / tool)

- `bedrock_ask` -- prompt one text model (alias or full model ID, or `level` instead of `model`); `schema` for JSON output, `effort` for thinking depth (Claude, GPT-6.x, Grok 4.7, Kimi K3, Gemma 4), `files` for local text files, `conversation_id` for follow-ups. The header shows an estimated cost.
- `bedrock_compare` -- same prompt to 2-5 models side by side (or `level` for three); takes `schema`, `effort` and `files`.
- `bedrock_judge` -- 2-5 models answer (or `level` for three), a judge model (default claude-opus, Opus 5.5) scores them blind and picks a winner; the verdict uses structured output when the judge supports it. Takes `files`; `level` never changes the judge.
- `bedrock_doctor` -- one small billed call per text model (or the `models` given); status ok / throttled / denied / invalid / error.
- `bedrock_panel` -- 2-5 models discuss one prompt in turn, each seeing the earlier turns; optional `roles`, `rounds` (1-3), `summarize` (moderator model) and `level` (`cheap` / `medium` / `intense` default panels of three); takes `files`.
- `bedrock_generate_image` / `bedrock_generate_video` + `bedrock_video_status` -- media generation; the video tool takes `start_image_path` and `end_image_path` (Luma Ray 2 keyframes, JPEG or PNG, 512 to 4096 pixels a side).
- `bedrock_edit_image` -- one of 13 Stability image services on a local image (`operation`, `image_path`); the edit services are only on the `us.stability.*` profile.
- `bedrock_embed_similarity` -- cosine-similarity matrix across 2-50 inputs: `texts`, plus `images` (local JPEG or PNG) for `titan-multimodal` and `cohere`.
- MCP prompts: `second-opinion`, `compare-models`, `panel-discussion`.
- `.mcpb` bundle: `npm run pack:mcpb`, attached to each GitHub release by `release.yml`.

## Config               (CLI / tool)

- No config file; env vars only: `AWS_REGION`, `AWS_BEARER_TOKEN_BEDROCK` (or IAM chain: `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_PROFILE`), `BEDROCK_MCP_OUTPUT_DIR`, `BEDROCK_MCP_FILES_ROOT` (root folder for the `files` option, default the working folder).
