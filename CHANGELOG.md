# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed

- AWS-legacy models purged after a lifecycle scan (supersedes parts of 0.3.0 below): image generation moved from Amazon Nova Canvas + Titan Image Generator v2 (EOL) to Stability (Stable Image Ultra, SD3.5 Large), video from Nova Reel to Luma Ray 2, and Nova Premier / AI21 entries removed from the text registry. `src/models.test.ts` now bans the removed IDs as LEGACY.
- Claude Fable 5 (`global.anthropic.claude-fable-5`) added to the text registry as the most capable model.
- Opus 4.7 / 4.6 `useCase` relabeled "Previous-gen Opus reasoning" (Opus 4.8 is the Opus-tier flagship); stale Nova Reel comment and multi-shot output line removed; AI21 dropped from the provider-filter example.

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
