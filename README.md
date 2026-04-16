# bedrock-multi-model-mcp

MCP server for AWS Bedrock - text, image, and video generation from any model. Use Llama, Mistral, Nova, Cohere, DeepSeek, Stable Diffusion, and Claude from Claude Code (or any MCP client).

## Tools

| Tool | Description |
|------|-------------|
| `bedrock_ask` | Send a prompt to any text model. Returns response with token counts and latency. |
| `bedrock_compare` | Same prompt to 2-5 models side by side. Compare quality, speed, and style. |
| `bedrock_list_models` | List available text models with aliases and capabilities. |
| `bedrock_generate_image` | Generate images from text (Nova Canvas, Titan Image, SD 3.5, SDXL). Saves PNG locally. |
| `bedrock_generate_video` | Start async video generation (Nova Reel). Output to S3. |
| `bedrock_video_status` | Check video generation job progress. |

## Supported Models

### Text (Converse API)

| Provider | Models | Aliases |
|----------|--------|---------|
| Meta | Llama 4 Maverick, Llama 4 Scout, Llama 3.3 70B, Llama 3.1 405B | `llama4`, `llama4-scout`, `llama3.3`, `llama3.1-405b` |
| Mistral | Mistral Large 2, Mistral Small, Pixtral Large | `mistral-large`, `mistral-small`, `pixtral` |
| Amazon | Nova Pro, Nova Lite, Nova Micro | `nova-pro`, `nova-lite`, `nova-micro` |
| Cohere | Command R+, Command R | `command-r-plus`, `command-r` |
| AI21 | Jamba 1.5 Large | `jamba` |
| DeepSeek | DeepSeek R1 | `deepseek`, `deepseek-r1` |
| Anthropic | Claude Opus 4, Sonnet 4, Haiku 3.5 | `claude-opus`, `claude-sonnet`, `claude-haiku` |

### Image (InvokeModel API)

| Model | Alias | Max Resolution |
|-------|-------|----------------|
| Amazon Nova Canvas | `nova-canvas` | 2048x2048 |
| Amazon Titan Image Gen v2 | `titan-image` | 1408x1408 |
| Stability SD 3.5 Large | `sd3.5-large` | aspect ratio based |
| Stability SDXL 1.0 | `sdxl` | 1024x1024 |

### Video (Async API)

| Model | Duration | Resolution |
|-------|----------|------------|
| Amazon Nova Reel | 6s (single shot), 12-120s (multi-shot) | 1280x720 @ 24fps |

You can also pass any valid Bedrock model ID directly.

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

## Architecture

```
src/
  index.ts       # MCP server - tool registration, stdio transport
  converse.ts    # Bedrock Converse API wrapper (text models)
  image.ts       # Bedrock InvokeModel wrapper (image models)
  video.ts       # Bedrock async invoke wrapper (video models)
  models.ts      # Model registry with IDs, aliases, and capabilities
```

- **Text**: Uses the [Converse API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html) - unified interface across all text models
- **Image**: Uses [InvokeModel](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html) with model-specific request formats (handled internally)
- **Video**: Uses [StartAsyncInvoke](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_StartAsyncInvoke.html) - requires S3 bucket for output

## License

MIT
