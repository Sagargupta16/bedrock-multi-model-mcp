# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-04-16

### Added

- MCP server with stdio transport
- `bedrock_ask` tool for single-model prompts via Converse API
- `bedrock_compare` tool for side-by-side multi-model comparison (2-5 models)
- `bedrock_list_models` tool with provider filtering
- Model registry with 20 models across 7 providers (Anthropic, Meta, Mistral, Amazon, Cohere, AI21, DeepSeek)
- Short alias system for common models (e.g. `llama4`, `nova-pro`, `deepseek`)
- Token usage and latency tracking in responses
- Support for custom system prompts, temperature, and max tokens
