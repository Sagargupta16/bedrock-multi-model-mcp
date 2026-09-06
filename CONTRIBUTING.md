# Contributing

Thanks for taking a look. This is a small, focused MCP server, so most contributions are
either a model-registry update or a fix to one of the four API wrappers.

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

Both must pass before you open a pull request. CI runs the same two commands on Node 22
and Node 24.

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
2. **Check the parameters.** Current Claude models reject `temperature` with a 400
   (`` `temperature` is deprecated for this model. ``). Those entries need
   `"noTemperature": true`, otherwise the server sends its default and every call fails.
3. **Add an assertion.** Put a matching check in `src/models.test.ts` - at minimum that
   the alias resolves to the ID you intended. Bare-tier aliases (`claude-sonnet`,
   `fable`) track the current model in that tier; version-pinned aliases
   (`claude-sonnet-4.6`) keep the older model reachable.
4. **Only ACTIVE models.** Entries that AWS or the provider has marked end-of-life get
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
- Note user-facing changes in `CHANGELOG.md` under an `## [Unreleased]` heading or the
  version you are cutting.

## Reporting a security issue

Please don't open a public issue - see [SECURITY.md](SECURITY.md).
