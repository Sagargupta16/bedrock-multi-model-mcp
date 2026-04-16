# bedrock-multi-model-mcp

MCP server for invoking any AWS Bedrock model via the unified Converse API. Use Llama, Mistral, Nova, Cohere, DeepSeek, and Claude - all from Claude Code (or any MCP client).

## Tools

| Tool | Description |
|------|-------------|
| `bedrock_ask` | Send a prompt to any Bedrock model. Returns response with token counts and latency. |
| `bedrock_compare` | Send the same prompt to 2-5 models. Returns side-by-side responses for comparison. |
| `bedrock_list_models` | List available models with aliases, providers, and capabilities. |

## Supported Models

| Provider | Models | Aliases |
|----------|--------|---------|
| Meta | Llama 4 Maverick, Llama 4 Scout, Llama 3.3 70B, Llama 3.1 405B | `llama4`, `llama4-scout`, `llama3.3`, `llama3.1-405b` |
| Mistral | Mistral Large 2, Mistral Small, Pixtral Large | `mistral-large`, `mistral-small`, `pixtral` |
| Amazon | Nova Pro, Nova Lite, Nova Micro | `nova-pro`, `nova-lite`, `nova-micro` |
| Cohere | Command R+, Command R | `command-r-plus`, `command-r` |
| AI21 | Jamba 1.5 Large | `jamba` |
| DeepSeek | DeepSeek R1 | `deepseek`, `deepseek-r1` |
| Anthropic | Claude Opus 4, Sonnet 4, Haiku 3.5 | `claude-opus`, `claude-sonnet`, `claude-haiku` |

You can also pass any valid Bedrock model ID directly (e.g. `meta.llama3-2-90b-instruct-v1:0`).

## Setup

### Prerequisites

- Node.js >= 20
- AWS credentials configured (env vars, `~/.aws/credentials`, SSO, or IAM role)
- Bedrock model access enabled in your AWS account (request access in the AWS Console under Bedrock > Model access)

### Install and Build

```bash
git clone https://github.com/Sagargupta16/bedrock-multi-model-mcp.git
cd bedrock-multi-model-mcp
npm install
npm run build
```

### Configure in Claude Code

Add to your Claude Code MCP settings (`~/.claude/settings.json` or project `.claude/settings.local.json`):

```json
{
  "mcpServers": {
    "bedrock": {
      "command": "node",
      "args": ["C:/path/to/bedrock-multi-model-mcp/dist/index.js"],
      "env": {
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
| `AWS_ACCESS_KEY_ID` | - | AWS access key (if not using SSO/profile) |
| `AWS_SECRET_ACCESS_KEY` | - | AWS secret key (if not using SSO/profile) |
| `AWS_PROFILE` | - | Named AWS profile from `~/.aws/credentials` |

## Usage Examples

### Ask a single model

```
"Use bedrock_ask to ask llama4 to explain Docker containers in 3 sentences"
```

### Compare models

```
"Use bedrock_compare to compare llama4, nova-pro, and mistral-large on: What are the pros and cons of microservices?"
```

### List available models

```
"Use bedrock_list_models to show all Meta models"
```

## Architecture

```
src/
  index.ts       # MCP server - registers tools, handles stdio transport
  converse.ts    # AWS Bedrock Converse API wrapper
  models.ts      # Model registry with IDs, aliases, and capabilities
```

The server uses the Bedrock [Converse API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html) which provides a unified interface across all model providers. Same code, just swap the model ID.

## License

MIT
