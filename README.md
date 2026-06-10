# bedrock-multi-model-mcp

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

Model data lives in [src/data/](src/data/) (`text-models.json`, `image-models.json`, `video-models.json`) - edit those files to add or remove models without touching code.

### Text (Converse API)

| Provider | Models | Aliases |
|----------|--------|---------|
| Anthropic | Claude Opus 4.8 / 4.7 / 4.6, Sonnet 4.6, Haiku 4.5 | `claude-opus`, `claude-sonnet`, `claude-haiku` |
| Meta | Llama 4 Maverick, Llama 4 Scout, Llama 3.3 70B | `llama4`, `llama4-scout`, `llama3.3` |
| Mistral | Mistral Large 3, Devstral 2, Mistral Small, Pixtral Large | `mistral-large`, `devstral`, `mistral-small`, `pixtral` |
| Amazon | Nova Premier, Nova Pro, Nova 2 Lite, Nova Lite, Nova Micro | `nova-premier`, `nova-pro`, `nova2-lite`, `nova-lite`, `nova-micro` |
| Qwen | Qwen3 Coder Next, Qwen3 VL 235B | `qwen-coder`, `qwen-vl` |
| DeepSeek | DeepSeek V3.2, DeepSeek R1 | `deepseek`, `deepseek-r1` |
| AI21 | Jamba 1.5 Large | `jamba` |
| OpenAI | GPT-OSS 120B, GPT-OSS 20B | `gpt-oss`, `gpt-oss-20b` |

### Image (InvokeModel API)

| Model | Alias | Max Resolution | Region |
|-------|-------|----------------|--------|
| Stable Image Ultra (default) | `stable-ultra` | 1536x1536 | us-west-2 |
| Stable Diffusion 3.5 Large | `sd3.5` | 1536x1536 | us-west-2 |
| Stable Image Core | `stable-core` | 1536x1536 | us-west-2 |

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

You can also pass any valid Bedrock model ID directly. Note: many foundation models require a cross-region inference profile (`us.` prefix) for on-demand invocation - the registry uses the working form for each model.

> **Model availability varies by region and account.** The registry IDs are verified working in `us-east-1`, but individual models may not be enabled in your region or granted to your account. Models you can't access return a clear error (per-model in `bedrock_compare`); the rest still work. Enable models in the AWS Console under Bedrock > Model access.

## Setup

### Prerequisites

- Node.js >= 20
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

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AWS_REGION` | `us-east-1` | AWS region for Bedrock API calls |
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

### Generate an image

```
"Use bedrock_generate_image with nova-canvas: A futuristic Tokyo street at night, neon lights, rain"
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
    embedding-models.json  # Embedding model registry
```

Model definitions are data, kept in `src/data/*.json` and validated against Zod schemas at load time, so the catalog can be updated without changing logic. The build copies these JSON files into `dist/data/`.

- **Text**: Uses the [Converse API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html) - unified interface across all text models
- **Image**: Uses [InvokeModel](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html) with model-specific request formats (handled internally)
- **Video**: Uses [StartAsyncInvoke](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_StartAsyncInvoke.html) - requires S3 bucket for output

## License

MIT
