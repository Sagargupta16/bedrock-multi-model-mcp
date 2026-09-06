# bedrock-multi-model-mcp

[![Stars](https://img.shields.io/github/stars/Sagargupta16/bedrock-multi-model-mcp?style=flat-square)](https://github.com/Sagargupta16/bedrock-multi-model-mcp/stargazers)
[![Forks](https://img.shields.io/github/forks/Sagargupta16/bedrock-multi-model-mcp?style=flat-square)](https://github.com/Sagargupta16/bedrock-multi-model-mcp/network/members)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/Sagargupta16/bedrock-multi-model-mcp?style=flat-square)](https://github.com/Sagargupta16/bedrock-multi-model-mcp/commits/main)
[![CI](https://img.shields.io/github/actions/workflow/status/Sagargupta16/bedrock-multi-model-mcp/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/Sagargupta16/bedrock-multi-model-mcp/actions/workflows/ci.yml)

MCP server for AWS Bedrock - text, image, and video generation from any model. Use Claude, Llama, Mistral, Nova, Qwen, DeepSeek, GPT-OSS, and more from Claude Code (or any MCP client).

## Tools

| Tool | Description |
|------|-------------|
| `bedrock_ask` | Send a prompt to any text model. Returns response with token counts and latency. |
| `bedrock_compare` | Same prompt to 2-5 models side by side. Compare quality, speed, and style. |
| `bedrock_list_models` | List available text models with aliases, use cases, and capabilities. |
| `bedrock_generate_image` | Generate images from text (Stable Image Ultra, SD3.5 Large, Stable Image Core). Saves PNG locally. |
| `bedrock_generate_video` | Start async video generation (Luma Ray 2). Output to S3. |
| `bedrock_video_status` | Check video generation job progress. |
| `bedrock_embed_similarity` | Embed 2+ texts (Titan, Cohere) and return a cosine-similarity matrix. |

## Supported Models

Model data lives in [src/data/](src/data/) (`text-models.json`, `image-models.json`, `video-models.json`, `embedding-models.json`) - edit those files to add or remove models without touching code.

### Text (Converse API)

| Provider | Models | Aliases |
|----------|--------|---------|
| Anthropic | Claude Fable 5.1, Opus 5, Sonnet 5, Haiku 4.5 (current); Fable 5, Opus 4.8 / 4.7 / 4.6, Sonnet 4.6 (previous-gen) | `fable`, `claude-opus`, `claude-sonnet`, `claude-haiku` |
| Meta | Llama 4 Maverick, Llama 4 Scout, Llama 3.3 70B | `llama4`, `llama4-scout`, `llama3.3` |
| Mistral | Mistral Large 3, Devstral 2, Mistral Small, Pixtral Large | `mistral-large`, `devstral`, `mistral-small`, `pixtral` |
| Amazon | Nova Pro, Nova 2 Lite, Nova Lite, Nova Micro | `nova-pro`, `nova2-lite`, `nova-lite`, `nova-micro` |
| Qwen | Qwen3 Coder Next, Qwen3 VL 235B | `qwen-coder`, `qwen-vl` |
| DeepSeek | DeepSeek V3.2, DeepSeek R1 | `deepseek`, `deepseek-r1` |
| OpenAI | GPT-OSS 120B, GPT-OSS 20B | `gpt-oss`, `gpt-oss-20b` |

Bare-tier aliases (`fable`, `claude-opus`, `claude-sonnet`, `claude-haiku`) track the
current model in that tier; version-pinned aliases (`fable-5`, `claude-opus-4.8`,
`claude-sonnet-4.6`) keep the previous generation reachable. Anthropic's current
lineup is Claude Fable 5.1, Opus 5, Sonnet 5 and Haiku 4.5; the 4.x Opus / Sonnet
entries and Fable 5 are listed by Anthropic as legacy but still available.

The `maxTokens` value in `text-models.json` is the default output cap **this server**
sends when a call omits `max_tokens` - deliberately below the model's own ceiling
(Anthropic documents 128K max output for Fable 5.1, Opus 5 and Sonnet 5, 64K for
Haiku 4.5). Pass `max_tokens` to go higher on a single call.

### Image (InvokeModel API)

| Model | Alias | Region |
|-------|-------|--------|
| Stable Image Ultra (default) | `stable-ultra` | us-west-2 |
| Stable Diffusion 3.5 Large | `sd3.5` | us-west-2 |
| Stable Image Core | `stable-core` | us-west-2 |

Stability models take an **aspect ratio**, not pixel dimensions. The `width` and
`height` arguments only select the closest supported ratio (`1:1`, `16:9`, `9:16`,
`3:2`, `2:3`, `4:5`, `5:4`, `21:9`, `9:21`); the model picks the output pixels. The
size reported by `bedrock_generate_image` is read back out of the saved PNG, so it
is the real output size rather than what you asked for.

### Video (Async API)

| Model | Alias | Duration | Resolution | Region |
|-------|-------|----------|------------|--------|
| Luma Ray 2 | `luma-ray`, `ray2` | 5s or 9s | 720p | us-west-2 |

The output S3 bucket must be in us-west-2 (same region as the model).

Amazon Nova Canvas/Reel and Titan Image were removed when AWS marked them
end-of-life (Nova Reel EOL 2026-09-30); the registry only ships ACTIVE models.

### Embeddings (InvokeModel API)

| Model | Alias | Dimensions |
|-------|-------|------------|
| Amazon Titan Text Embeddings V2 | `titan-v2` | 1024 |
| Amazon Titan Text Embeddings V1 | `titan-v1` | 1536 |
| Amazon Titan Multimodal Embeddings | `titan-multimodal` | 1024 |
| Cohere Embed English v3 | `cohere-en` | 1024 |
| Cohere Embed Multilingual v3 | `cohere-multi` | 1024 |

`bedrock_embed_similarity` only sends text, so Titan Multimodal is exercised through
its text path here and behaves like `titan-v2` at the same 1024 dimensions.

You can also pass any valid Bedrock model ID directly. Note: many foundation models require a cross-region inference profile (`us.` prefix) for on-demand invocation - the registry uses the working form for each model.

> **Model availability varies by region and account.** The registry IDs are verified working in `us-east-1`, but individual models may not be enabled in your region or granted to your account. Models you can't access return a clear error (per-model in `bedrock_compare`); the rest still work. Enable models in the AWS Console under Bedrock > Model access.

## Setup

### Prerequisites

- Node.js >= 22 (Node 20 reached end of life on 2026-04-30; CI runs 22 and 24)
- AWS credentials configured (bearer token, env vars, `~/.aws/credentials`, SSO, or IAM role)
- Bedrock model access enabled in your AWS account (request access in the AWS Console under Bedrock > Model access)

### Install and Build

```bash
git clone https://github.com/Sagargupta16/bedrock-multi-model-mcp.git
cd bedrock-multi-model-mcp
npm install
npm run build
```

### Configure in Claude Code

Add to your Claude Code MCP settings (`~/.claude.json`):

```json
{
  "mcpServers": {
    "bedrock": {
      "command": "node",
      "args": ["/path/to/bedrock-multi-model-mcp/dist/index.js"],
      "env": {
        "AWS_BEARER_TOKEN_BEDROCK": "ABSK...",
        "AWS_REGION": "us-east-1"
      }
    }
  }
}
```

### Configure in Claude Desktop

Same server block, in `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "bedrock": {
      "command": "node",
      "args": ["/path/to/bedrock-multi-model-mcp/dist/index.js"],
      "env": {
        "AWS_BEARER_TOKEN_BEDROCK": "ABSK...",
        "AWS_REGION": "us-east-1",
        "BEDROCK_MCP_OUTPUT_DIR": "C:\\Users\\you\\bedrock-images"
      }
    }
  }
}
```

Set `BEDROCK_MCP_OUTPUT_DIR` explicitly for Desktop: on Windows it spawns the server
from a write-protected directory (`C:\Windows\System32`), so the default "save next to
cwd" behavior cannot apply and generated images fall back to `~/bedrock-images/`.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AWS_REGION` | `us-east-1` | AWS region for Bedrock API calls |
| `AWS_DEFAULT_REGION` | - | Fallback region, used only when `AWS_REGION` is unset |
| `AWS_BEARER_TOKEN_BEDROCK` | - | Bedrock API Key bearer token (recommended) |
| `AWS_ACCESS_KEY_ID` | - | AWS access key (if not using bearer token/SSO) |
| `AWS_SECRET_ACCESS_KEY` | - | AWS secret key (if not using bearer token/SSO) |
| `AWS_PROFILE` | - | Named AWS profile from `~/.aws/credentials` |
| `BEDROCK_MCP_OUTPUT_DIR` | cwd (or `~/bedrock-images` if cwd is not writable) | Default output directory for generated images. Overridden by the `output_dir` tool arg. Directory is auto-created. |

### Authentication

The server supports two auth methods:

1. **Bedrock API Key (bearer token)** - Set `AWS_BEARER_TOKEN_BEDROCK`. The SDK (v3.840.0+) reads this automatically. If the SDK fails, falls back to raw HTTP with `Authorization: Bearer` header.
2. **IAM credentials** - Standard AWS credential chain (env vars, profile, SSO, IAM role).

## Usage Examples

### Ask a single model

```
"Use bedrock_ask to ask llama4 to explain Docker in 3 sentences"
```

### Compare models

```
"Use bedrock_compare with llama4, nova-pro, and mistral-large: What are the pros and cons of microservices?"
```

`bedrock_compare` runs one full generation per model in the list, and each one is
billed independently - three models is three generations, five is five. This server
adds no markup and sets no rates; billing is entirely AWS Bedrock's, per model and
per token. Current rates: [AWS Bedrock pricing](https://aws.amazon.com/bedrock/pricing/)
and, for the Claude models, [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing).

### Generate an image

```
"Use bedrock_generate_image with stable-ultra: A futuristic Tokyo street at night, neon lights, rain"
```

### Generate a video

```
"Use bedrock_generate_video: Closeup of ocean waves crashing on rocks at sunset, s3_uri: s3://my-bucket/videos/"
```

### Compare text similarity

```
"Use bedrock_embed_similarity to compare: 'a cat', 'a kitten', 'a car'"
```

## Architecture

```
src/
  index.ts          # MCP server - tool registration, stdio transport
  models.ts         # Loads + validates text-model data, resolves aliases
  types.ts          # Zod schemas for model data validation
  bedrock/
    client.ts       # Shared region/auth config + raw HTTP fallback
    converse.ts     # Converse API wrapper (text models)
    image.ts        # InvokeModel wrapper (image models)
    video.ts        # Async invoke wrapper (video models)
    embed.ts        # InvokeModel wrapper (embeddings) + cosine similarity
  data/
    text-models.json       # Text model registry (data, not code)
    image-models.json      # Image model registry
    video-models.json      # Video model registry
    embedding-models.json  # Embedding model registry
```

Model definitions are data, kept in `src/data/*.json` and validated against Zod schemas at load time, so the catalog can be updated without changing logic. The build copies these JSON files into `dist/data/`.

- **Text**: Uses the [Converse API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html) - unified interface across all text models
- **Image**: Uses [InvokeModel](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html) with model-specific request formats (handled internally)
- **Video**: Uses [StartAsyncInvoke](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_StartAsyncInvoke.html) - requires S3 bucket for output

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `The provided model identifier is invalid.` | The ID does not resolve on Bedrock - usually a missing `us.` cross-region inference profile prefix, or a model that is not offered in your region. | Use a registry alias (`bedrock_list_models`), or add the `us.` prefix to the full ID. |
| `` `temperature` is deprecated for this model. `` | A current Claude model was reached without a registry entry, so the server sent its default `temperature`. Current Claude models reject the parameter outright. | Call it through a registered alias, or add a registry entry with `"noTemperature": true` in `src/data/text-models.json`. |
| `AccessDeniedException` | Model access has not been granted to your account. | AWS Console > Bedrock > Model access, request the model, retry once it shows Access granted. |
| Video job starts but never produces output | The output S3 bucket is not in the model's region. | Point `s3_uri` at a bucket in `us-west-2` (Luma Ray 2's region). |

Error strings are surfaced verbatim from Bedrock. Note that the `temperature` one is a
registry gap in this server, not an IAM or model-access problem - there is nothing to
fix in AWS for it.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the two required checks, and the rules
for adding a model (registry data + a test assertion + a live probe of the model ID).
Security issues go through the private route in [SECURITY.md](SECURITY.md), not a public
issue.

## More AI Developer Tools

| Repo | What it does |
|------|--------------|
| [mcp-toolkit](https://github.com/Sagargupta16/mcp-toolkit) | TypeScript middleware toolkit for MCP servers - authentication, caching, rate limiting, CORS, logging |
| [claude-cost-optimizer](https://github.com/Sagargupta16/claude-cost-optimizer) | Strategies, benchmarks, and configs for cutting Claude Code costs |
| [ai-git-hooks](https://github.com/Sagargupta16/ai-git-hooks) | AI-powered git hooks - review diffs, generate commit messages, scan for secrets |
| [claude-code-recipes](https://github.com/Sagargupta16/claude-code-recipes) | Copy-paste recipes for Claude Code commands, subagents, hooks, skills, and MCP |
| [agent-recipes](https://github.com/Sagargupta16/agent-recipes) | Copy-paste AI agent workflows for code review, testing, and DevOps automation |

## License

MIT
