# Benchmark results

Measured 2026-10-18 in us-east-1 by `scripts/benchmark.mjs`: 2 prompts x 3 runs per model, temperature 0 where accepted, 256-token output cap. 26 of 26 models answered, 156 of 156 calls succeeded. Latency is the median client wall-clock time for the whole call, sorted fastest first. "Hit cap" counts answers cut off at 256 tokens, which also caps their token counts.

| Model | Provider | Median latency (s) | Median output tokens | Median output tokens/s | Hit cap | OK |
| --- | --- | --- | --- | --- | --- | --- |
| Nova Lite | Amazon | 1.13 | 56 | 50 | 0 | 6/6 |
| Nova Micro | Amazon | 1.18 | 59 | 46 | 0 | 6/6 |
| Mistral Large 3 (675B) | Mistral | 1.25 | 61 | 50 | 0 | 6/6 |
| Qwen3 Coder Next | Qwen | 1.29 | 71 | 37 | 0 | 6/6 |
| Llama 4 Maverick 17B | Meta | 1.35 | 87 | 65 | 0 | 6/6 |
| Llama 4 Scout 17B | Meta | 1.36 | 99 | 71 | 0 | 6/6 |
| Nova Pro | Amazon | 1.49 | 61 | 43 | 0 | 6/6 |
| GPT-OSS 20B | OpenAI | 1.50 | 206 | 114 | 2 | 6/6 |
| Llama 3.3 70B Instruct | Meta | 1.52 | 107 | 66 | 0 | 6/6 |
| Nova 2 Lite | Amazon | 1.55 | 80 | 53 | 0 | 6/6 |
| GPT-OSS 120B | OpenAI | 1.82 | 152 | 88 | 1 | 6/6 |
| Devstral 2 (123B) | Mistral | 1.88 | 63 | 35 | 0 | 6/6 |
| Pixtral Large | Mistral | 2.06 | 85 | 42 | 0 | 6/6 |
| Claude Sonnet 4.6 | Anthropic | 2.10 | 77 | 36 | 0 | 6/6 |
| Qwen3 VL 235B | Qwen | 2.15 | 58 | 28 | 0 | 6/6 |
| Mistral Small | Mistral | 2.31 | 98 | 42 | 0 | 6/6 |
| DeepSeek R1 | DeepSeek | 2.35 | 256 | 109 | 6 | 6/6 |
| Claude Haiku 4.5 | Anthropic | 2.38 | 179 | 71 | 3 | 6/6 |
| Claude Opus 4.7 | Anthropic | 2.40 | 98 | 39 | 0 | 6/6 |
| Claude Sonnet 5 | Anthropic | 2.69 | 98 | 36 | 0 | 6/6 |
| Claude Opus 4.8 | Anthropic | 2.79 | 111 | 39 | 0 | 6/6 |
| Claude Opus 4.6 | Anthropic | 3.42 | 80 | 24 | 0 | 6/6 |
| Claude Fable 5 | Anthropic | 4.18 | 134 | 30 | 0 | 6/6 |
| Claude Opus 5 | Anthropic | 4.46 | 154 | 30 | 1 | 6/6 |
| DeepSeek V3.2 | DeepSeek | 4.60 | 55 | 13 | 0 | 6/6 |
| Claude Fable 5.1 | Anthropic | 5.61 | 127 | 21 | 0 | 6/6 |
