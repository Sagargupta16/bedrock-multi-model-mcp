# Security Policy

## Reporting a vulnerability

Please report security issues privately, **not** through a public issue.

Use GitHub's private vulnerability reporting: open the
[Security tab](https://github.com/Sagargupta16/bedrock-multi-model-mcp/security/advisories/new)
and choose "Report a vulnerability". That thread is visible only to the maintainer until
an advisory is published.

Please include the affected version or commit, what an attacker can do with it, and the
smallest set of steps that reproduces it.

## Why this matters here

This server brokers AWS credentials. The AWS SDK reads `AWS_BEARER_TOKEN_BEDROCK` (a
Bedrock API key) and sends it as an `Authorization: Bearer` header, and otherwise falls
back to the standard AWS credential chain - environment variables, `~/.aws/credentials`,
a named profile, SSO, or an instance role. Anything that can redirect, log, or echo those
requests is in scope, including:

- credential or token material reaching stdout, stderr, an error message, or a saved file
- a model ID, region, ARN, or S3 URI from tool input steering a request to a host other
  than `bedrock-runtime.<region>.amazonaws.com`, or `bedrock-mantle.<region>.api.aws` for
  the Gemma 4 models, which this server calls with the bearer token
- path traversal through `output_dir` or the generated image filename
- `bedrock_edit_image` reading and sending a local file that is not an image: it reads
  `image_path`, `mask_path` and `style_image_path` and sends only files that start like a
  PNG, JPEG or WebP
- the `files` option of `bedrock_ask`, `bedrock_compare`, `bedrock_judge` and `bedrock_panel`
  reading outside its root folder (`BEDROCK_MCP_FILES_ROOT`, default the server's working
  folder; symlinks are resolved first) or reading a secret store such as `.env`, `.npmrc`,
  `.git-credentials`, a private key or anything under `.ssh` or `.aws`. The name filter is a
  second layer, not the boundary: the root is. It reads up to 10 text files, 256 KB each and
  1 MB in total. What it reads is added to the prompt, so it is sent to the model provider
  (and, in `bedrock_judge` and `bedrock_panel`, to every model in the call; with
  `conversation_id`, again on each follow-up). When the root is unset and the working folder
  is a home folder or a drive root, `files` refuses to run: point the root at a project folder
- any tool opening a network or device path (`\\host\share\...`, `\\?\...`) passed as a file
  or image path: on Windows that would offer your login to the named host, so these are
  refused before any file call
- `conversation_id` on `bedrock_ask` keeping turns anywhere but process memory: they are
  never written to disk, are forgotten 30 minutes after the last turn or when the server
  restarts, and are not shared between conversation ids
- `bedrock_doctor` making billed calls: it sends one small call (at most 32 output tokens)
  to each text model, so it runs only when asked, but it does cost a little on every run
- prompt or tool input that escapes into a shell, a filesystem write outside the
  configured output directory, or another AWS API

## Handling credentials

Never paste a real bearer token, access key, or session token into an issue, a pull
request, a test fixture, or a log excerpt. Redact them, and refer to credentials by
environment-variable name. If a real credential has already been exposed, rotate it
first, then report.

## Scope

Only the code in this repository is in scope. Vulnerabilities in AWS Bedrock itself or in
the underlying foundation models belong to
[AWS security](https://aws.amazon.com/security/vulnerability-reporting/). Issues in a
dependency should go to that project; open a regular issue here if this repository needs
to pin or bump it.
