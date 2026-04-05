# WikiWire specification

WikiWire is a GitHub Action that syncs changed files under `modules/` and `templates/` to a MediaWiki site via the [Action API](https://www.mediawiki.org/wiki/API:Main_page). Credentials are supplied only through the action inputs (or workflow secrets), never through the config file.

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
| `username` | yes | — | Bot username; with [Bot passwords](https://www.mediawiki.org/wiki/Manual:Bot_passwords), use `UserName@BotPasswordName`. |
| `password` | yes | — | Bot password value. |
| `config_path` | no | `wikiwire.toml` | Path to the TOML config. |
| `ignore_path` | no | `.wikiwireignore` | Path to the ignore file (may be missing). |
| `dry_run` | no | `false` | If `true`, no edits are sent (site-level `dry_run` in TOML still applies per site). |
| `sync_all` | no | `false` | If `true`, sync every file under `modules/` and `templates/` from the workspace instead of using commit diffs. Requires a prior checkout of the repo. |

Use a workflow `permissions` block with at least `contents: read` so the default `GITHUB_TOKEN` can call the compare API.

### Example workflow

```yaml
name: WikiWire

on:
  push:
    branches: [main]

jobs:
  wikiwire:
    runs-on: ubuntu-latest
    name: Sync files to upstream MediaWiki
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: obbywiki/wikiwire@v1
        with:
          username: WikiWireBot@BotPasswordNameHere
          password: ${{ secrets.WIKI_PASSWORD }}
```

## Security

- Store `password` in GitHub **secrets**, not in the workflow YAML.
- Prefer **Bot passwords** with the minimum rights needed (`editpage`, `highvolume`, etc.).
- The config file must remain free of secrets so it can be committed safely.

## Limitations (v1)

- **Deletes:** Removing a file from git does **not** delete the wiki page.
- **Renames:** Appear as delete + add; see deletes.
- **Initial push:** When GitHub sends an all-zero `before` SHA, the action uses the single `push` head commit’s file list instead of `compareCommits`.
- **Branches:** Use per-site `default_branch` or workflow `on.push.branches` to avoid syncing from unintended branches.

## Releases

After changing `src/`, run `pnpm install` and `pnpm build` so `dist/index.js` is updated before tagging a release consumers pin to.
