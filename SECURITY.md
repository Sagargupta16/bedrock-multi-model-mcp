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

This server brokers AWS credentials. It reads `AWS_BEARER_TOKEN_BEDROCK` (a Bedrock API
key) and otherwise falls back to the standard AWS credential chain - environment
variables, `~/.aws/credentials`, a named profile, SSO, or an instance role. When the SDK
path fails it retries over raw HTTPS with an `Authorization: Bearer` header. Anything
that can redirect, log, or echo those requests is in scope, including:

- credential or token material reaching stdout, stderr, an error message, or a saved file
- a model ID, region, ARN, or S3 URI from tool input steering a request to a host other
  than `bedrock-runtime.<region>.amazonaws.com`
- path traversal through `output_dir` or the generated image filename
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
