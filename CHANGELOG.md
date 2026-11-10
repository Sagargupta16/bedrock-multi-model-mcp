# Changelog

All notable changes to this project will be documented in this file.

## [0.8.0] - 2026-11-10

### Added

- Claude Fable 5.2 (`us.anthropic.claude-fable-5-2`, on Bedrock since 2026-11-09), GPT-6 Astra (`gpt-astra`, the model AWS's card calls OpenAI's most capable) and GPT-6 Luna (`gpt-luna`, OpenAI's fast tier). Each was live-probed on 2026-11-10: all three take `schema` and `effort` from `low` to `max`, and reject `temperature`, so they are flagged `noTemperature`.

### Changed

- **Breaking:** bare `fable` and `claude-fable` now resolve to Fable 5.2. Fable 5.1 stays reachable as `fable-5.1` and `claude-fable-5.1`.
- `@aws-sdk/client-bedrock-runtime` floor raised to ^3.1165.0.

### Removed

- **Breaking:** Claude Fable 5 (`fable-5`), now two versions behind Fable 5.2.

### Not added

- Kimi K3.1 Pro - Highspeed (`us.moonshotai.kimi-k3.1`, on Bedrock since 2026-11-04): every probe call on 2026-11-10 was throttled ("Too many tokens"), on the US and the global profile, so it stays out until a call answers. `kimi` still resolves to Kimi K3.

## [0.7.1] - 2026-11-01

### Changed

- README setup installs from npm: `claude mcp add ... -- npx -y bedrock-multi-model-mcp` and an `npx` server block for Claude Code and Claude Desktop, instead of cloning and building. Building from source moved to "Run from source".
- First release through `release.yml` with the npm trusted publisher (GitHub OIDC, no token), so this version carries npm provenance; 0.7.0 was published by hand.

## [0.7.0] - 2026-11-01

### Added

- `bedrock_edit_image` tool for the 13 Stability AI Image Services on Bedrock (`us.stability.*` profiles, us-west-2): `inpaint`, `outpaint`, `erase`, `remove-background`, `search-replace`, `search-recolor`, `upscale-fast`, `upscale-conservative`, `upscale-creative`, `control-sketch`, `control-structure`, `style-guide`, `style-transfer`.
  - The tool takes a local PNG, JPEG or WebP (`image_path`, plus `mask_path` or `style_image_path` where the service uses one) and saves the result as a PNG, the same way `bedrock_generate_image` does.
  - Each service's required and optional fields live in `src/data/image-edit-models.json`. A missing or unsupported field is refused before the billed call, and so is a file that is not one of those image formats.
  - Every operation was live-probed on 2026-11-01.
  - The three upscalers return 4x images whose PNG is 22 to 43 MB, over Bedrock's 16 MB response limit, so they default to WebP (about 2.5 to 5.5 MB). `output_format` overrides this per call.
- Gemma 4 31B (`gemma`), Gemma 4 26B A4B (`gemma-4-26b`) and Gemma 4 E2B (`gemma-4-e2b`), served only on Bedrock's OpenAI-compatible `bedrock-mantle` endpoint.
  - A new `"api": "mantle"` registry field routes them to `src/bedrock/mantle.ts`, which calls Chat Completions at `https://bedrock-mantle.<region>.api.aws/openai/v1`. The request is built by the same `buildConverseInput`, so option checks, output caps and temperature rules match, and compare and judge mix them with Converse models.
  - Probed on 2026-11-01:
    - plain calls, `temperature`, system prompts and a JSON schema (`response_format`) all answered;
    - `effort` (`reasoning_effort`) takes `low` to `xhigh`, while `max` gets a 400 ("not supported with this model");
    - an abort at 400 ms settled at 411 ms.
  - These models need `AWS_BEARER_TOKEN_BEDROCK`. AWS also accepts SigV4 on mantle, but this server does not sign mantle requests and says so when the token is missing.
  - Grok 4.3, also mantle-only, is left out because Grok 4.7 supersedes it.
- Nine text models, each live-probed on 2026-11-01 for a plain call, `temperature`, `schema` and `effort` before it was added:
  - GPT-6.1 Sol (`gpt-sol`) and GPT-6.1 Terra (`gpt-terra`), Grok 4.7 (`grok`) and Kimi K3 (`kimi`). All four take `schema` and `effort` and reject `temperature` ("This model doesn't support the temperature field"), so they are flagged `noTemperature`.
  - MiniMax M2.5 (`minimax`), Nemotron 3 Super 120B (`nemotron`), Ministral 3 14B (`ministral`) and Qwen3 Next 80B A3B (`qwen-next`). These take `schema` and `temperature`, not `effort`.
  - Magistral Small (`magistral`). It is not flagged `structured_output`: it accepted `outputConfig.textFormat` but ignored it, answering with fenced JSON and a different key.
- Cohere Embed v4 (`cohere.embed-v4:0`, alias `cohere`, 1536 dimensions). Its response keys the vectors by type (`{ float: [...] }`) even when no type is requested, unlike v3's bare array; `embed()` reads both, and it also recognizes the `us.cohere.` inference profile.
- `scripts/check-lifecycle.mjs` (`npm run lifecycle`) fails when a registry model is listed on AWS's public model lifecycle page. It needs no credentials. `.github/workflows/lifecycle.yml` runs it weekly and on PRs that touch `src/data/`. Against the 0.6.0 registry it flags exactly the five Legacy models below.
- Cancellation: every tool except `bedrock_generate_video` passes the MCP request's abort signal to Bedrock, so a cancelled or timed-out tool call stops the request. Measured on 2026-11-01: a Nova Micro call aborted at 400 ms settled at 412 ms; the same call left to finish took 6.4 s. Video starts are excluded on purpose, because cancelling a sent `StartAsyncInvoke` could leave a billed job with no ARN to track.

### Removed

- **Breaking:** Llama 4 Maverick (`llama4`), Llama 4 Scout, Llama 3.3 70B, Devstral 2 and DeepSeek R1.
  - AWS moved all five to Legacy on 2026-09-30, with EOL on 2027-03-30, and "new customers can't use Legacy models". So the `llama4` examples in the tool descriptions and README failed for new accounts.
  - AWS lists no Active Meta model, so Llama leaves the catalog.
- **Breaking:** these Active but superseded models are removed:
  - Claude Opus 4.8 and 4.7 (`claude-opus-4.8`, `claude-opus-4.7`); Opus 5 and 5.5 cover them, and Opus 4.6 stays as the Opus that still takes `temperature`.
  - Mistral Small 2402 (`mistral-small`), now covered by Ministral 3.
  - Titan Text Embeddings V1 (`titan-v1`).
  - Cohere Embed English and Multilingual v3. Their aliases (`cohere-en`, `cohere-english`, `cohere-multi`, `cohere-multilingual`) now resolve to Embed v4.
- The raw-HTTP bearer-token fallback (`withBearerFallback`, `bedrockFetch`) and its 7 tests.
  - With `AWS_BEARER_TOKEN_BEDROCK` set, the SDK already sends that token, ahead of any IAM keys, so the retry resent the same rejected credential and could never succeed.
  - Its `bedrock_video_status` branch also requested `/async-invoke/<id>` where the API takes the full ARN.
- The Amazon image request shape and the image registry's `format` field. Every Active text-to-image model on Bedrock is Stability's (Nova Canvas reached EOL on 2026-09-30), so an image id outside the registry now gets the Stability shape too.
- The `rimraf` dev dependency; `npm run clean` uses `fs.rmSync`.

### Fixed

- A set-but-empty `AWS_BEARER_TOKEN_BEDROCK` broke every call with "request could not be signed with `token` since the `token` is not defined".
  - This happens with an MCP config that passes `"${AWS_BEARER_TOKEN_BEDROCK}"` from a client whose own environment lacks the variable: the SDK picks bearer auth whenever the variable exists.
  - The server now drops an empty value at startup, so the IAM credential chain answers.
- `bedrock_compare` reported success when every model failed; it now sets `isError` in that case. Partial failures still return the answers that came back.
- Two images finished in the same millisecond overwrote each other. File names now end in an 8-character random suffix.
- `max_tokens` on `bedrock_ask`, `bedrock_compare` and `bedrock_judge` accepted fractions, and `seed` on `bedrock_generate_image` accepted fractions and negatives, all of which Bedrock then rejected. The tool schemas now refuse them.
- Titan embeddings ran one request after another (50 texts, 50 round trips in a row). They now run 8 at a time.
- `server.json` described 26 text models; the registry has 33 now.

### Security

- `npm audit` went from 5 findings to 0, closing the 6 open Dependabot alerts:
  - body-parser 2.3.0 -> 2.4.0 (GHSA-27r3-jxmh-p828, high) and fast-uri 3.1.8 -> 3.1.9 (4 advisories), both through `@modelcontextprotocol/sdk` 1.32.2.
  - glob and minimatch left with rimraf.
- Manifest floors raised to `@aws-sdk/client-bedrock-runtime` ^3.1161.0 and `@modelcontextprotocol/sdk` ^1.32.2.

### Changed

- One `loadRegistry` and `indexByAlias` in `src/models.ts` replace the four copies of registry loading and alias indexing. One `errorResult` in `src/index.ts` replaces six copies of the error branch. `firstImage` and `saveImage` in `src/bedrock/image.ts` are shared by image generation and editing.
- Examples in the tool descriptions, README and scripts use `kimi` instead of `llama4`. The `effort` and `schema` descriptions list the models that take them.
- `release.yml` skips `npm publish` when npm already has the version. The first version is published by hand (npm attaches a trusted publisher only to an existing package), so its tag now goes on to the MCP Registry step, and a rerun after a failed registry step no longer stops at npm. `package.json` `repository.url` uses the `git+https` form npm normalizes to, so `npm publish` no longer auto-corrects it.

## [0.6.0] - 2026-10-21

### Added

- Claude Opus 5.5 (`us.anthropic.claude-opus-5-5`), Sonnet 5.5 (`us.anthropic.claude-sonnet-5-5`) and Haiku 5.5 (`us.anthropic.claude-haiku-5-5`) in the text registry, each flagged `noTemperature` (all three returned "`temperature` is deprecated for this model" when probed on 2026-10-21) with pinned aliases `opus-5.5`, `sonnet-5.5`, `haiku-5.5` and their `claude-` forms.
- `schema` on `bedrock_ask` and `bedrock_compare`: a JSON schema sent as Converse `outputConfig.textFormat`, so the reply is JSON that matches it, printed as a JSON block. A new `structured_output` capability marks the 19 models that accepted it in a live probe of every registry model on 2026-10-21 (all 12 Claude, Mistral Large 3, Devstral 2, Qwen3 Coder Next, Qwen3 VL, DeepSeek V3.2, GPT-OSS 120B and 20B). The other 10 (Nova, Llama, Mistral Small, Pixtral, DeepSeek R1) are refused before the call with the list of models that do support it.
- `effort` on `bedrock_ask`, `bedrock_compare` and `bedrock_judge` (`low` to `max`), sent as Converse `outputConfig.effort`. The new registry flag `effort` marks every Claude model except Haiku 4.5, which rejected it. Measured on Haiku 5.5: 3 output tokens at `low` and 60 at `max` for the same one-line answer. `bedrock_ask` rejects it for other models; compare and judge apply it only to the candidates that take it. `bedrock_list_models` shows `effort` in the Capabilities column.
- `bedrock_judge` asks a structured-output judge for its verdict against a schema whose `winner` is limited to the answer labels and whose `scores` require every label, so the verdict always parses. Judges without the capability keep the prompt-only JSON request.
- `src/bedrock/converse.test.ts`: 7 tests for request building (`buildConverseInput`), per-model effort (`effortFor`) and the JSON reply parser. 50 tests in all, up from 39.

### Changed

- **Breaking:** bare `claude-opus`, `claude-sonnet` and `claude-haiku` now resolve to the 5.5 models, and so does the default judge. `claude-haiku` used to reach Haiku 4.5, which honours `temperature`; the 5.5 models do not, so pin `claude-haiku-4.5` to keep setting it. `claude-opus-5`, `claude-sonnet-5` and `claude-haiku-4.5` keep the previous models reachable.

### Fixed

- GPT-OSS on Bedrock returns schema-constrained JSON with a stray leading character (`B{"city":...}`, seen 2026-10-21). `parseJsonReply` retries from the first brace, so the JSON still prints.

## [0.5.0] - 2026-10-18

### Added

- `bedrock_judge` tool: 2-5 candidate models answer the same prompt, then a judge model (default `claude-opus`) scores them 1-10 and names a winner. The judge sees the answers shuffled and labeled A, B, C with the model names removed, so it cannot favor a name or a position; the tool maps the labels back and returns a ranked table (a tie on score ranks the judge's winner first), the judge's reasoning and every answer. `criteria` changes what is scored and `synthesize: true` adds one merged answer. A failed candidate is listed and the rest are still judged; a failed judge call still returns the answers. Logic lives in `src/judge.ts` with 11 tests in `src/judge.test.ts`.
- `scripts/benchmark.mjs` (`npm run benchmark`): runs 2 fixed prompts x 3 runs through every text model and writes `docs/benchmark/results.json`, `docs/benchmark/RESULTS.md` and the README table. The first run (2026-10-18, us-east-1) got 156 of 156 calls answered across all 26 models, with medians from 1.13 s (Nova Lite) to 5.61 s (Claude Fable 5.1). `--from <results.json>` re-renders the table without calling Bedrock.
- `scripts/call-tool.mjs`: a minimal stdio MCP client that spawns the built server, lists its tools or calls one with credentials from the shell.
- Animated terminal demo of a live `bedrock_judge` run at the top of the README (`docs/demo/judge-dark.svg` and `judge-light.svg`, arguments in `docs/demo/judge-args.json`).
- npm and MCP Registry release prep: `mcpName` in `package.json`, a `server.json` that passes `mcp-publisher validate`, and `.github/workflows/release.yml`, which on a `v*` tag checks the tag against both manifests, runs lint and tests, publishes to npm with trusted publishing (OIDC, no stored token) and then publishes to the MCP Registry with `mcp-publisher login github-oidc`. A test fails if `server.json` and `package.json` disagree on name or version. Setup steps are in CONTRIBUTING, "Releasing".

### Fixed

- The bearer-token HTTP fallback retried after any SDK error, so a throttled or timed-out `StartAsyncInvoke` could start a second billed video job, and a real error was replaced by the fallback's. It now retries only on auth rejections that happen before Bedrock does any work (`CredentialsProviderError`, `TokenProviderError`, `UnrecognizedClientException`, signature and token errors, `AccessDeniedException`). Throttling, timeouts, 5xx and validation errors are returned as they are. If the retry fails too, the error names both causes and keeps the SDK error as `cause`. One `withBearerFallback` helper in `client.ts` replaces the five copies in the wrappers, with 7 tests in `src/bedrock/client.test.ts`.

## [0.4.1] - 2026-10-18

### Security

- Dependency refresh for 5 `npm audit` findings (1 critical, 2 high, 2 moderate): `proxy-addr` 2.0.7 -> 2.0.8 (GHSA-jqcg-44mw-7w3h, the open Dependabot alert), `@modelcontextprotocol/sdk` 1.30.0 -> 1.32.1 (GHSA-6qxp-vccf-f47h, fixed in 1.31.0), `brace-expansion` -> 5.0.12, `fast-uri` -> 3.1.8, `ip-address` -> 10.7.4. Manifest floors raised so a fresh install cannot resolve the vulnerable ranges: `@aws-sdk/client-bedrock-runtime` ^3.1152.0, `@modelcontextprotocol/sdk` ^1.32.1, `zod` ^4.6.7, `@types/node` ^22.20.5. `npm audit` reports 0 vulnerabilities.
- CI installs with `npm ci --ignore-scripts` (SonarCloud githubactions:S6505, the open code-scanning alert). No dependency needs an install script.

### Changed

- `typescript` 6.0.3 -> 7.0.2 (the native compiler). `tsc --noEmit` and the build pass unchanged on the existing `tsconfig.json`.
- README: a "Why" paragraph and registry counts up top, a Mermaid architecture diagram with the request path, a design-decisions table, and a one-command `claude mcp add` setup. The intro now lists embeddings alongside text, image and video.
- CONTRIBUTING: changelog entries go under the concrete next version with a matching `package.json` bump, not an `Unreleased` heading.

### Fixed

- `npm test` passed `dist/**/*.test.js` unquoted, so on Linux `sh` (no globstar) it only ran by accident: with no test file one level down the shell passed the pattern through and Node expanded it. The first test added under `src/bedrock/` would have made `sh` expand it to that file alone and silently skip `dist/models.test.js`. The pattern is now quoted, so Node's own glob always sees it.

## [0.4.0] - 2026-09-06

### Added

- Claude Fable 5.1 (`us.anthropic.claude-fable-5-1`) and Claude Sonnet 5 (`us.anthropic.claude-sonnet-5`) in the text registry, both flagged `noTemperature`. Bare `fable` and `claude-sonnet` now point at them.
- `CONTRIBUTING.md` (setup, the two checks, the rules for adding a model) and `SECURITY.md` (private reporting route, and what is in scope for a server that brokers AWS credentials).
- README: a Troubleshooting table, a Claude Desktop config block, a per-model billing note on `bedrock_compare`, an `AWS_DEFAULT_REGION` row in the env table, and CI/license/activity badges.
- Tests for `readPngSize` and for the `package.json` version path. The capability check now asserts the schema rejects an unknown token, instead of iterating a registry that Zod has already validated at import.

### Fixed

- `bedrock_generate_image` reported the requested size, not the real one: Stability models receive only an `aspect_ratio`, so `width`/`height` were echoed back verbatim. Measured 2026-09-06 - a `stable-core` request for 1920x1080 reported `Size: 1920x1080` and wrote a 2016x1152 PNG. The size now comes from the saved PNG's IHDR chunk, and is omitted when the payload is not a parsable PNG.
- `bedrock_video_status` read only `status`, so a failed job reported no cause. It now reads `failureMessage` and prints it as `Reason:`.
- `src/index.ts` hardcoded `version: "0.3.0"` while `package.json` was `0.3.1`. It now reads the version from `package.json` and cannot drift.
- Bare `claude-sonnet` resolved to Sonnet 4.6 and bare `fable` to Fable 5, against this repo's convention that bare-tier aliases track the current model in their tier. They now resolve to Sonnet 5 and Fable 5.1, with `claude-sonnet-4.6` and `fable-5` keeping the previous generation reachable.
- Claude Fable 5 declared `tool-use` where every other entry uses `tool_use` (printed verbatim in the `bedrock_list_models` Capabilities column) and was the only Anthropic entry missing `streaming`.
- `amazon.titan-embed-image-v1` was labeled `modality: "text"` while named "Titan Multimodal Embeddings"; corrected to `multimodal`, with a README note that `bedrock_embed_similarity` only exercises its text path.
- Dropped `maxResolution: "1536x1536"` from the image registry and its schema. Nothing read it, and the measured 2016x1152 output contradicts it.

### Changed

- **Breaking:** `duration_seconds` on `bedrock_generate_video` is now `5 | 9` instead of any number. It used to coerce anything below 9 to 5, so a caller passing 7 got a 5-second video; that call is now rejected at the schema boundary. Pass 5 or 9.
- **Breaking:** bare `claude-sonnet` and `fable` resolve to entries that omit `temperature`, which Anthropic deprecated for Claude Opus 4.7 and later. The argument is still accepted but has no effect through those aliases; pin `claude-sonnet-4.6` or use `claude-haiku` to set it.
- `engines.node` raised from `>=20.0.0` to `>=22.0.0`. Node 20 reached end of life on 2026-04-30. README prerequisite updated to match.
- CI now runs a Node 22 / 24 / 26 matrix instead of Node 22 alone, on `actions/checkout@v7` and `actions/setup-node@v7` (both were a major behind), with `permissions: contents: read` and a ref-keyed concurrency group that cancels superseded runs.
- `useCase` labels follow Anthropic's current lineup: Fable 5 and Sonnet 4.6 relabeled previous-gen (matching how Opus 4.8 / 4.7 / 4.6 are already handled), and Opus 5 described as the recommended starting point.
- `TextModelSchema.capabilities` is now a closed `z.enum` over the known tokens, so the next capability typo fails at registry load instead of reaching the tool output.
- `width` / `height` on `bedrock_generate_image` are documented for what they actually do - pick the closest supported aspect ratio - instead of "must be divisible by 16", which never applied to the Stability models. The README image table lists the supported ratios instead of a max resolution.
- Dependency refresh, lockfile only: `@aws-sdk/client-bedrock-runtime` 3.1030.0 -> 3.1127.0, `@modelcontextprotocol/sdk` 1.29.0 -> 1.30.0, `zod` 4.3.6 -> 4.5.4, `@types/node` 22.19.17 -> 22.20.1. 40 packages change version, 65 transitive packages drop and 2 are added. The transitive `@hono/node-server` crosses a major (1.19.17 -> 2.1.1) because the MCP SDK widened its range to `^1.19.9 || ^2.0.5`. `npm audit` reports 0 vulnerabilities.
- `CLAUDE.md` said "No CI workflows"; a lint + test workflow has existed since 2026-07-04.

## [0.3.1] - 2026-09-02

### Security

- Bumped transitive dependencies to resolve 16 open Dependabot alerts: `hono` 4.12.25 -> 4.13.5, `@hono/node-server` 1.19.14 -> 1.19.17, `fast-uri` 3.1.2 -> 3.1.7, `ip-address` 10.2.0 -> 10.7.0, `body-parser` 2.2.2 -> 2.3.0, `brace-expansion` 5.0.6 -> 5.0.9. Lockfile-only refresh; `npm audit` now reports 0 vulnerabilities.
- `qs` 6.15.2 -> 6.16.0 for GHSA-x5fp-wj9c-mxmx, an array-limit bypass via bracket-key comma parsing (medium). 6.15.2 sat inside the affected range `>= 6.14.2, <= 6.15.3`; 6.16.0 is the first patched release. Transitive through `body-parser` and `express`, so lockfile only (2026-09-05).

### Added

- Claude Opus 5 (`us.anthropic.claude-opus-5`) in the text registry, with the bare `claude-opus` alias moved onto it (2026-07-25).
- Lint + test CI workflow on push to `main` and on pull requests (2026-07-04).

### Fixed

- Stability image models report content-filter and inference failures in `finish_reasons` with no `error` field, so a filtered generation surfaced as the opaque "Model returned no image data". The finish reason is now raised as the error message (2026-07-01).
- A full model ID passed to `bedrock_generate_image` did not resolve to its registry entry, so a Stability model received the Amazon request shape and failed; `bedrock_video_status` now takes the region from the invocation ARN instead of the default region (2026-07-03).

### Changed

- AWS-legacy models purged after a lifecycle scan (supersedes parts of 0.3.0 below): image generation moved from Amazon Nova Canvas + Titan Image Generator v2 (EOL) to Stability (Stable Image Ultra, SD3.5 Large), video from Nova Reel to Luma Ray 2, and Nova Premier / AI21 entries removed from the text registry. `src/models.test.ts` now bans the removed IDs as LEGACY.
- Claude Fable 5 added to the text registry as the most capable model. It ships as `us.anthropic.claude-fable-5`; the `global.` inference profile was corrected to `us.` on 2026-07-03.
- Opus 4.7 / 4.6 `useCase` relabeled "Previous-gen Opus reasoning" (Opus 4.8 is the Opus-tier flagship); stale Nova Reel comment and multi-shot output line removed; AI21 dropped from the provider-filter example.
- `typescript` bumped to 6; `package.json` description synced with the repo description (2026-07-03).

## [0.3.0] - 2026-06-07

### Fixed

- `claude-sonnet` alias pointed at `us.anthropic.claude-sonnet-4-6-v1`, which does not exist (Bedrock returns "invalid model identifier"). Corrected to `us.anthropic.claude-sonnet-4-6`.
- Text model IDs that require a cross-region inference profile now use the working `us.` prefix (Claude, Llama, Pixtral, DeepSeek R1) instead of bare IDs that fail on-demand invocation.
- `bedrock_generate_image` silently ignored `width`/`height` and reported a fabricated output size. Dimensions are now sent to the model and honored.
- Image tool listed Stability edit/upscale models that require an input image no tool parameter supplied, and a default `nova-canvas` that resolved to a removed entry. Image generation was effectively broken; restored with working Amazon models.

### Added

- `bedrock_embed_similarity` tool - embeds 2-50 texts (Amazon Titan, Cohere) and returns a cosine-similarity matrix. Embedding registry in `src/data/embedding-models.json`.
- Claude Opus 4.8, Nova Premier, Nova 2 Lite, GPT-OSS 120B/20B to the text registry (all verified invokable).
- `useCase` field per model, surfaced as a column in `bedrock_list_models`.
- `src/models.test.ts` - asserts every alias resolves to a registry model (guards the drift that caused the broken sonnet alias).

### Changed

- Model data extracted from `.ts` logic into `src/data/text-models.json` and `src/data/image-models.json`, validated by Zod schemas at load time. Editable without recompiling.
- Restructured: API wrappers moved to `src/bedrock/` with a shared `client.ts`; `src/types.ts` holds data schemas.
- Migrated tool registration from the deprecated `server.tool()` to `server.registerTool()` with read-only/open-world annotations.
- Image generation restored to Amazon Nova Canvas + Titan Image Generator v2 (both verified generating real PNGs with honored dimensions). Removed the inaccessible Stability edit/upscale entries.
- `zod` is now an explicit dependency (was relied on transitively via the MCP SDK).

## [0.2.1] - 2026-05-06

### Fixed

- Image save path used `process.cwd()` unconditionally, which fails when Claude Desktop spawns the MCP from `C:\Windows\System32` (write-protected).

### Changed

- `bedrock_generate_image` now accepts an `output_dir` tool parameter so callers can choose where images land (absolute or relative to cwd).
- Fallback resolution order: `output_dir` arg -> `BEDROCK_MCP_OUTPUT_DIR` env -> `cwd` when writable and not a system directory -> `~/bedrock-images/`. Output directory is auto-created.

## [0.2.0] - 2026-04-16

### Added

- `bedrock_generate_image` tool - text-to-image via Nova Canvas, Titan Image, SD 3.5, SDXL
- `bedrock_generate_video` tool - async video generation via Nova Reel (single-shot and multi-shot)
- `bedrock_video_status` tool - check video generation job progress
- Image model registry with 4 models and aliases (nova-canvas, titan-image, sd3.5-large, sdxl)
- Style presets for Nova Canvas (PHOTOREALISM, 3D_ANIMATED_FAMILY_FILM, etc.) and SDXL
- Negative prompt support for all image models
- Generated images saved to ~/bedrock-images/ as PNG
- Bearer token auth fallback via raw HTTP for all APIs (InvokeModel, StartAsyncInvoke, GetAsyncInvoke)

## [0.1.0] - 2026-04-16

### Added

- MCP server with stdio transport
- `bedrock_ask` tool for single-model prompts via Converse API
- `bedrock_compare` tool for side-by-side multi-model comparison (2-5 models)
- `bedrock_list_models` tool with provider filtering
- Model registry with 20 text models across 7 providers (Anthropic, Meta, Mistral, Amazon, Cohere, AI21, DeepSeek)
- Short alias system for common models (e.g. `llama4`, `nova-pro`, `deepseek`)
- Token usage and latency tracking in responses
- Bearer token auth support via `AWS_BEARER_TOKEN_BEDROCK` env var with raw HTTP fallback
