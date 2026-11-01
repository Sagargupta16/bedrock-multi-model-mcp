# Contributing

Thanks for taking a look. This is a small, focused MCP server, so most contributions are
either a model-registry update or a fix to one of the four API wrappers (or `src/judge.ts`,
which builds `bedrock_judge` on top of the text wrapper).

## Getting set up

```bash
git clone https://github.com/Sagargupta16/bedrock-multi-model-mcp.git
cd bedrock-multi-model-mcp
npm install
npm run build
```

Requirements: Node.js >= 22 and npm (the lockfile, scripts, and `prepublishOnly` flow are
npm-based - please don't convert the project to another package manager).

## Checks

Both must pass before you open a pull request. CI runs the same two commands on Node 22,
24 and 26.

```bash
npm run lint    # tsc --noEmit
npm test        # builds, then node --test dist/**/*.test.js
```

Tests run against the compiled output in `dist/`, so `npm test` builds first. If you edit
a file under `src/data/` without rebuilding, a locally running server keeps the old
catalog - the build copies `src/data/` into `dist/data/`.

## Adding or changing a model

Model definitions are **data**, not code. Add the entry to the matching registry in
`src/data/` (`text-models.json`, `image-models.json`, `video-models.json`,
`embedding-models.json`) rather than to any `.ts` file. The registries are validated
against the Zod schemas in `src/types.ts` at load time, so a malformed entry fails at
startup instead of at call time.

Before a new model ID lands:

1. **Live-probe it.** Invoke the exact ID you are adding against Bedrock and confirm you
   get a real completion (or a real image/video/embedding) back. Many foundation models
   need the `us.` cross-region inference profile prefix for on-demand invocation, and the
   registry stores the verified-working form per model. `The provided model identifier is
   invalid.` means the ID does not resolve.
2. **Check the parameters.** Anthropic lists `temperature` / `top_p` / `top_k` as
   deprecated for Claude Opus 4.7 and later, where a non-default value returns a 400
   (`` `temperature` is deprecated for this model. ``). Those entries need
   `"noTemperature": true`, otherwise the server sends its default 0.7 and every call
   fails. Earlier models still accept it (Haiku 4.5, Opus 4.6 and Sonnet 4.6 all answer
   normally with it), so add the flag only for a model that actually returns the 400 -
   setting it otherwise just drops the caller's `temperature` silently. Some non-Claude
   models refuse it too (GPT-6.1, Grok 4.7 and Kimi K3 answer "This model doesn't
   support the temperature field").
3. **Probe the two options.** Send one call with Converse `outputConfig.textFormat` (a small
   JSON schema) and one with `outputConfig.effort`. Add `structured_output` to
   `capabilities` and `"effort": true` only for what the model accepted; a model that
   rejects either answers "This model doesn't support the outputConfig field" or "...the
   effort field". Accepted is not the same as honored: check that the reply really
   matches the schema (Magistral Small accepted it and answered with a different key).
   `src/models.test.ts` pins both lists.
4. **Add an assertion.** Put a matching check in `src/models.test.ts` - at minimum that
   the alias resolves to the ID you intended. Bare-tier aliases (`claude-sonnet`,
   `fable`) track the current model in that tier; version-pinned aliases
   (`claude-sonnet-4.6`) keep the older model reachable.
5. **Pick the API.** A text model that Bedrock serves only on the OpenAI-compatible
   `bedrock-mantle` endpoint (no Converse, per its AWS model card) gets `"api": "mantle"`;
   probe it over Chat Completions at `https://bedrock-mantle.<region>.api.aws/openai/v1`
   with the Bedrock API key as the bearer token, with `max_tokens` large enough that a
   reasoning model has room to answer.
6. **Only ACTIVE models.** Entries that AWS or the provider has marked Legacy or
   end-of-life get removed, not kept for compatibility: AWS blocks new customers from
   Legacy models months before their EOL date. Run `npm run lifecycle`, which checks
   every registry id against AWS's public lifecycle page with no credentials; CI runs it
   weekly and on every PR that touches `src/data/`. `src/models.test.ts` bans the IDs
   already retired.

Update the model table in `README.md` in the same change so the docs and the registry
cannot drift apart.

## Pull requests

- Branch from `main`: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`, `chore/<topic>`.
- Conventional commit subjects, lowercase and imperative, no trailing period:
  `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`.
- Keep a pull request to one work stream, and say in the body what you verified and how.
  For anything that talks to Bedrock, "the types compile" is not verification - name the
  call you made and what came back.
- Note user-facing changes in `CHANGELOG.md` under the concrete next version (for example
  `## [0.5.1] - YYYY-MM-DD`), never an `Unreleased` heading, and bump `package.json` and
  both `version` fields in `server.json` to match (a test fails on any skew).

## Releasing

Pushing a `v*` tag runs [`.github/workflows/release.yml`](.github/workflows/release.yml):
it checks that the tag, `package.json` and `server.json` agree, runs lint and tests,
publishes to npm, then publishes `server.json` to the official MCP Registry. Neither step
uses a stored token: npm uses trusted publishing (GitHub OIDC, provenance attached) and
`mcp-publisher login github-oidc` uses the same OIDC token, which proves ownership of the
`io.github.Sagargupta16/*` namespace. The npm step is skipped when npm already has the
version, so a rerun after a failed registry step goes straight to the registry.

One-time setup, done by the maintainer:

1. The first version is published by hand, because npm attaches a trusted publisher only
   to a package that already exists: `npm login`, then `npm publish --access public` from
   an up-to-date `main`. Tagging that version afterwards runs the workflow, which skips
   npm and publishes to the MCP Registry.
2. Add the trusted publisher right before the next release, not earlier: npm expires a
   new trusted publisher if no publish succeeds within 2 days. With npm 11.15 or later:
   `npm trust github bedrock-multi-model-mcp --file release.yml --repo Sagargupta16/bedrock-multi-model-mcp --env release --allow-publish`
   (or npmjs.com, package settings, Trusted publishing, GitHub Actions: workflow
   `release.yml`, environment `release`).
3. Tag and push: `git tag v<version>`, then `git push origin v<version>`.

Validate `server.json` locally with `mcp-publisher validate server.json` before tagging.

## Reporting a security issue

Please don't open a public issue - see [SECURITY.md](SECURITY.md).
