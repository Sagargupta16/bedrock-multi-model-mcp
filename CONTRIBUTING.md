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
   setting it otherwise just drops the caller's `temperature` silently.
3. **Probe the two options.** Send one call with Converse `outputConfig.textFormat` (a small
   JSON schema) and one with `outputConfig.effort`. Add `structured_output` to
   `capabilities` and `"effort": true` only for what the model accepted; a model that
   rejects either answers "This model doesn't support the outputConfig field" or "...the
   effort field". `src/models.test.ts` pins both lists.
4. **Add an assertion.** Put a matching check in `src/models.test.ts` - at minimum that
   the alias resolves to the ID you intended. Bare-tier aliases (`claude-sonnet`,
   `fable`) track the current model in that tier; version-pinned aliases
   (`claude-sonnet-4.6`) keep the older model reachable.
5. **Only ACTIVE models.** Entries that AWS or the provider has marked end-of-life get
   removed, not kept for compatibility. `src/models.test.ts` bans the IDs already retired.

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
`io.github.Sagargupta16/*` namespace.

One-time setup, done by the maintainer:

1. On npmjs.com, package settings > Trusted publishing > GitHub Actions: repository
   `Sagargupta16/bedrock-multi-model-mcp`, workflow `release.yml`, environment `release`.
2. If npm will not attach a trusted publisher to a name that has never been published,
   publish the first version by hand instead (`npm login`, `npm publish --access public`,
   then `mcp-publisher login github` and `mcp-publisher publish`), add the trusted
   publisher, and let tags drive every release after that.
3. Tag and push: `git tag v0.5.0`, then `git push origin v0.5.0`.

Validate `server.json` locally with `mcp-publisher validate server.json` before tagging.

## Reporting a security issue

Please don't open a public issue - see [SECURITY.md](SECURITY.md).
