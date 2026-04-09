# WikiWire specification

WikiWire is a GitHub Action that syncs changed files under `modules/` and `templates/` to a MediaWiki site via the [Action API](https://www.mediawiki.org/wiki/API:Action_API). Credentials are supplied only through the action inputs (or workflow secrets), never through the config file.

## Repository layout

Wiki content lives under a **path segment** (second directory under `modules/` or `templates/`):

- **Modules:** `modules/<path_segment>/<root_name>/…`
- **Templates:** `templates/<path_segment>/<root_name>/…`

For a normal site, `<path_segment>` is the site’s `id` in `wikiwire.toml`, or its optional `host` value if set (see configuration). That keeps a stable `id` in config while the repo folder can stay a hostname.

**Shared bucket (optional):** If `shared = true` in `wikiwire.toml`, `modules/shared/` and `templates/shared/` are synced to **every** configured site. Wiki titles are the same as for a single site (the `shared` segment is not part of the title). When `shared` is false, paths under `modules/shared/` or `templates/shared/` cause the action to fail with a clear error.

Example:

```text
modules/obbywiki.com/GroupLink/GroupLink.module.lua
modules/obbywiki.com/GroupLink/doc.wikitext
modules/obbywiki.com/GroupLink/styles.css
modules/obbywiki.com/GroupLink/i18n/en.json
templates/obbywiki.com/Infobox/Infobox.template.wikitext
modules/shared/CommonUtil/CommonUtil.module.lua
```

- `<path_segment>` must match a site’s `id` or `host`, or be the literal `shared` when `shared = true`.
- `<root_name>` is the module or template root (e.g. `GroupLink`). For the main module file and template file, the basename in the filename must match `<root_name>`.

### Paths skipped automatically

Any path under `modules/` or `templates/` that contains a **path component starting with `_`** is skipped (not synced). Examples: `modules/_legacy/…`, `modules/example.com/MyModule/_draft/example.wikitext`, `modules/example.com/shared/_imported/…`.

## Path to wiki title mapping

| Root | Repository path | Wiki title | Content model |
|------|-------------------|------------|----------------|
| `modules` | `modules/<path_segment>/<root>/<root>.module.lua` | `Module:<root>` | `scribunto` |
| `modules` | `modules/<path_segment>/<root>/doc.wikitext` | `Module:<root>/doc` | `wikitext` |
| `modules` | `modules/<path_segment>/<root>/<any other path>` | `Module:<root>/<any other path>` | See below |
| `templates` | `templates/<path_segment>/<root>/<root>.template.wikitext` | `Template:<root>` | `wikitext` |

Any other file under `modules/<path_segment>/<root>/` maps 1:1: the wiki subpage path is exactly the relative path under `<root>/`, including nested directories (for example `i18n/en.json` becomes `Module:GroupLink/i18n/en.json`).

### Content models (non-special files under `modules/`)

Suffix matching is ordered; the first match wins:

| Pattern | Content model |
|---------|----------------|
| `*.template.wikitext` | (invalid under `modules/`; the action fails with a clear error) |
| `*.module.lua` | `scribunto` |
| `*.module.luau` | `scribunto` |
| `*.wikitext` | `wikitext` |
| `*.css` | Per-site `css_content_model` in `wikiwire.toml` (default `sanitized-css`) |
| `*.json` | `json` |
| Anything else | Error: unsupported extension |

Templates must live under `templates/`, not `modules/`.

## Configuration: `wikiwire.toml`

Place at the repository root unless you override with the `config_path` action input.

### Top-level

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `version` | integer | no | Config schema version; default `1`. Reserved for future use. |
| `shared` | boolean | no | If true, enables `modules/shared/` and `templates/shared/`, synced to every `[[sites]]` entry. Default false. |

### `[[sites]]` (repeatable)

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `id` | string | yes | Stable site key (sessions, logs). Must be unique across rows. |
| `host` | string | no | Directory name under `modules/` and `templates/`. If omitted, defaults to `id`. Must be unique across sites. Cannot be `shared` when `shared = true` (that name is reserved). |
| `api` | string | yes | Full MediaWiki API URL, e.g. `https://example.org/w/api.php`. |
| `dry_run` | boolean | no | If true, only log planned edits; no `action=edit` requests for this site. |
| `default_branch` | string | no | If set, the action skips syncing when the workflow ref is not this branch (e.g. `refs/heads/main`). |
| `css_content_model` | string | no | Content model for `*.css` module subpages. Default `sanitized-css`. Some wikis need `css`. |

Example:

```toml
# This is a global WikiWire configuration file, a CI action which automatically syncs and uploads modules and templates from a Git repo towards a production or upstream MediaWiki instance via bot passwords and the MediaWiki Action API.
# Learn more: https://github.com/obbywiki/wikiwire

version = 1
shared = true

[[sites]]
id = "obbywiki.com"
api = "https://obbywiki.com/w/api.php"

[[sites]]
id = "dev"
host = "dev.example.org"
api = "https://dev.example.org/w/api.php"
dry_run = true
default_branch = "main"
css_content_model = "css"
```

Credentials are **not** stored in this file. Use action inputs backed by secrets.

## `.wikiwireignore`

Optional file at the repository root (override with `ignore_path`). Patterns are relative to the repo root and follow **.gitignore** semantics (comments `#`, blank lines ignored; `**` and negation supported via the `ignore` package).

Ignored paths are skipped after change detection and never uploaded. Ignoring a path does **not** delete anything on the wiki.

Example:

```gitignore
# Legacy copies kept in git only
modules/obbywiki.com/ObbyGameInfobox/ObbyGameInfoboxLegacy.module.lua
modules/obbywiki.com/ObbyGameInfobox/ObbyGameInfoboxLegacy.template.wikitext
```

## GitHub Action inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `username` | no | `""` | Default bot username for sites not listed in `site_credentials`. With [Bot passwords](https://www.mediawiki.org/wiki/Manual:Bot_passwords), use `UserName@BotPasswordName`. |
| `password` | no | `""` | Default bot password for sites not listed in `site_credentials`. |
| `site_credentials` | no | `""` | JSON object whose keys are site `id` values from `wikiwire.toml` (not `host`). Each value must be `{"username":"…","password":"…"}`. Overrides the global `username` / `password` for that site. Keys that do not match any configured site produce a workflow warning. |
| `config_path` | no | `wikiwire.toml` | Path to the TOML config. |
| `ignore_path` | no | `.wikiwireignore` | Path to the ignore file (may be missing). |
| `dry_run` | no | `false` | If `true`, no edits are sent (site-level `dry_run` in TOML still applies per site). |
| `sync_all` | no | `false` | If `true`, sync every file under `modules/` and `templates/` from the workspace instead of using commit diffs. Requires a prior checkout of the repo. |
| `dark_lua_compat` | no | `""` | Deprecated; ignored. Kept so existing workflows are not flagged for an unknown input. Luau modules are always synced as Scribunto. |

Use a workflow `permissions` block with at least `contents: read` so the default `GITHUB_TOKEN` can call the compare API.

Every site that performs a real (non–dry-run) sync must resolve to a username and password: either the global inputs or a matching entry in `site_credentials`.

### Example workflow

```yaml
name: WikiWire

on:
  push:
    branches: [main]
    paths:
      - 'modules/**'
      - 'modules/*'
      - 'templates/**'
      - 'templates/*'

jobs:
  wikiwire:
    runs-on: ubuntu-latest
    name: Sync files to upstream MediaWiki
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: obbywiki/wikiwire@latest
        with:
          username: WikiWireBot@BotPasswordNameHere
          password: ${{ secrets.WIKI_PASSWORD }}
```

## Darklua in CI (pre-upload)

WikiWire uploads whatever is in the checked-out workspace under `modules/` and `templates/`. If you generate or transform Lua/Luau in CI (for example with Darklua), run that step **before** WikiWire.

If the transformed files are generated during the workflow (not present in the push diff), use `sync_all: "true"` so WikiWire uploads from the filesystem instead of the GitHub compare API.

Example (outline):

```yaml
    steps:
      - uses: actions/checkout@v4
      # install your tooling (darklua, compiler, etc.)
      # run darklua so modules/** contains the final output
      - uses: obbywiki/wikiwire@latest
        with:
          sync_all: "true"
          username: WikiWireBot@BotPasswordNameHere
          password: ${{ secrets.WIKI_PASSWORD }}
```

### Darklua without `sync_all` (transpile only changed Luau modules)

If you want to avoid `sync_all`, the files you intend to upload must exist in the **push diff** that WikiWire detects. A common pattern is to:

- Keep Luau source files as `*.module.luau`
- Generate sibling `*.module.lua` files with Darklua (and **commit** them)
- Have WikiWire upload only the changed `*.module.lua` files (diff-based; no `sync_all`)

In this setup, add `*.module.luau` to `.wikiwireignore` if you want WikiWire to upload only the generated `*.module.lua` files and not the Luau sources.

Example workflow (outline; assumes the `*.module.lua` outputs are committed alongside sources):

```yaml
name: WikiWire (with Darklua)

on:
  push:
    branches: [main]
    paths:
      - 'modules/**'
      - 'templates/**'

jobs:
  darklua_check:
    name: Verify Darklua outputs are up-to-date
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4

      - name: Install Darklua # (pick your preferred installation method) and make sure its up to date
        run: |
          wget https://github.com/seaofvoices/darklua/releases/download/v0.18.0/darklua-linux-x86_64.zip
          unzip darklua-linux-x86_64.zip
          chmod +x darklua

      - name: Regenerate Lua outputs for changed Luau modules
        shell: bash
        run: |
          set -euo pipefail

          changed_files="$(git diff --name-only "${{ github.event.before }}" "${{ github.sha }}")"
          while IFS= read -r path; do
            [[ "$path" == modules/**/*.module.luau ]] || continue

            out_path="${path%.module.luau}.module.lua"
            mkdir -p "$(dirname "$out_path")"

            # Example CLI shape (adjust flags to your darklua config)
            darklua process --config .darklua.json "$path" "$out_path"
          done <<< "$changed_files"

      - name: Fail if outputs were not committed
        run: git diff --exit-code

  wikiwire:
    name: Sync files to upstream MediaWiki
    runs-on: ubuntu-latest
    needs: [darklua_check]
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: obbywiki/wikiwire@latest
        with:
          # default: sync_all: "false"
          username: WikiWireBot@BotPasswordNameHere
          password: ${{ secrets.WIKI_PASSWORD }}
```

### Example: different credentials per site

Use `site_credentials` with one JSON object. Interpolate secrets per field, or store the entire JSON in a single secret and pass `site_credentials: ${{ secrets.WIKIWIRE_SITE_CREDENTIALS_JSON }}`.

```yaml
      - uses: obbywiki/wikiwire@latest
        with:
          site_credentials: |
            {
              "production.example": {
                "username": "WikiWireBot@prod",
                "password": "${{ secrets.WIKI_PASSWORD_PROD }}"
              },
              "dev": {
                "username": "WikiWireBot@dev",
                "password": "${{ secrets.WIKI_PASSWORD_DEV }}"
              }
            }
```

You can combine global `username` / `password` with `site_credentials`: only sites with an entry in the JSON use the per-site pair; all others use the defaults.

## Security

- Store `password` and per-site passwords in GitHub **secrets**, not in committed workflow YAML (except `${{ secrets.* }}` references).
- Prefer **Bot passwords** with the minimum rights needed (`editpage`, `highvolume`, etc.).
- The config file must remain free of secrets so it can be committed safely.

## Limitations (v1)

- **Deletes:** Removing a file from git does **not** delete the wiki page.
- **Renames:** Appear as delete + add; see deletes.
- **Initial push:** When GitHub sends an all-zero `before` SHA, the action uses the single `push` head commit’s file list instead of `compareCommits`.
- **Branches:** Use per-site `default_branch` or workflow `on.push.branches` to avoid syncing from unintended branches.

## Releases

After changing `src/`, run `pnpm install` and `pnpm build` so `dist/index.js` is updated before tagging a release consumers pin to.
