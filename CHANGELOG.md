# Changelog

All notable changes to this project will be documented in this file.

## [0.4.0] - 2026-09-06

### Added

- Claude Fable 5.1 (`us.anthropic.claude-fable-5-1`) and Claude Sonnet 5 (`us.anthropic.claude-sonnet-5`) in the text registry, both with `noTemperature: true`. Anthropic's live docs list them as current (Fable 5 and Sonnet 4.6 moved to "legacy, still available"). Both IDs already resolved on Bedrock but were unreachable through this server: with no registry entry, `converse.ts` sent its default `temperature` and every call failed with `400 ... temperature is deprecated for this model.`
- `CONTRIBUTING.md` (setup, the two checks, and the rule that a new model ID is live-probed and gets a `models.test.ts` assertion before it lands) and `SECURITY.md` (private reporting route, and what is in scope for a server that brokers AWS credentials).
- README: a Troubleshooting table keyed on the exact error strings the server surfaces, a Claude Desktop config block (with the `BEDROCK_MCP_OUTPUT_DIR` note for its write-protected spawn directory), a per-model billing note on `bedrock_compare`, an `AWS_DEFAULT_REGION` row in the env table, and CI/license/activity badges.

### Fixed

- `bedrock_generate_image` reported a fabricated output size again - a regression of the 0.3.0 fix, reintroduced when image generation moved to the Stability request shape. Stability models receive only an `aspect_ratio`, so the requested `width`/`height` were echoed back verbatim. Measured 2026-09-06: a `stable-core` call for 1920x1080 reported `Size: 1920x1080` and wrote a 2016x1152 PNG. The size now comes from the saved PNG's IHDR chunk, and is omitted from the response when the payload is not a parsable PNG.
- `src/index.ts` hardcoded `version: "0.3.0"` while `package.json` was `0.3.1`, so every MCP client was told the wrong server version. It now reads the version from `package.json` and cannot drift.
- Bare `claude-sonnet` resolved to legacy Sonnet 4.6 and bare `fable` to Fable 5, against this repo's own convention that bare-tier aliases track the current model in their tier. They now resolve to Sonnet 5 and Fable 5.1; `claude-sonnet-4.6` and `fable-5` keep the previous generation reachable.
- Claude Fable 5 declared `tool-use` where every other entry uses `tool_use` (printed verbatim in the `bedrock_list_models` Capabilities column) and was the only Anthropic entry missing `streaming`.
- `duration_seconds` on `bedrock_generate_video` accepted any number and silently coerced anything below 9 to 5, so a caller asking for 7 got a 5-second video reported as 5s. It is now `5 | 9`, rejected at the schema boundary.
- `amazon.titan-embed-image-v1` was labeled `modality: "text"` while named "Titan Multimodal Embeddings"; corrected to `multimodal`, with a README note that `bedrock_embed_similarity` only exercises its text path.

### Changed

- `engines.node` raised from `>=20.0.0` to `>=22.0.0`. Node 20 reached end of life on 2026-04-30; 22 is the oldest supported line. README prerequisite updated to match.
- CI now runs a Node 22 + 24 matrix (the declared floor and the current Active LTS) instead of Node 22 alone, on `actions/checkout@v7` and `actions/setup-node@v7` (both were a major behind), with `permissions: contents: read` and a ref-keyed concurrency group that cancels superseded runs.
- `useCase` labels follow Anthropic's current lineup: Fable 5 and Sonnet 4.6 relabeled previous-gen (matching how Opus 4.8 / 4.7 / 4.6 are already handled), and Opus 5 described as the recommended starting point.
- `TextModelSchema.capabilities` is now a closed `z.enum` over the known tokens, so the next capability typo fails at registry load instead of reaching the tool output. `models.test.ts` asserts it too.
- `width` / `height` on `bedrock_generate_image` are documented for what they actually do - pick the closest supported aspect ratio - instead of "must be divisible by 16", which never applied to the Stability models. The README image table lists the supported ratios instead of a "Max Resolution" that the measured output contradicted.
- Dependency refresh inside the existing ranges (lockfile only): `@aws-sdk/client-bedrock-runtime` 3.1030.0 -> 3.1127.0, `@modelcontextprotocol/sdk` 1.29.0 -> 1.30.0, `zod` 4.3.6 -> 4.5.4, `@types/node` 22.19.17 -> 22.20.1. The AWS SDK bump inlines its Smithy dependencies, dropping 63 transitive packages from the lockfile. `npm audit` reports 0 vulnerabilities.
- `CLAUDE.md` said "No CI workflows"; a lint + test workflow has existed since 2026-07-04.
- `.gitignore`: dropped the `!jest.config.js` / `!eslint.config.js` negations and the `.next/` entry - this repo uses neither Jest nor ESLint (tests are `node:test`, `lint` is `tsc --noEmit`) and is not a Next.js app.

## [0.3.1] - 2026-09-02

### Security

- Bumped transitive dependencies to resolve 16 open Dependabot alerts: `hono` 4.12.25 -> 4.13.5, `@hono/node-server` 1.19.14 -> 1.19.17, `fast-uri` 3.1.2 -> 3.1.7, `ip-address` 10.2.0 -> 10.7.0, `body-parser` 2.2.2 -> 2.3.0, `brace-expansion` 5.0.6 -> 5.0.9. Lockfile-only refresh; `npm audit` now reports 0 vulnerabilities.

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
