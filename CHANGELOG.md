# Changelog

All notable changes to this project will be documented in this file.

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
