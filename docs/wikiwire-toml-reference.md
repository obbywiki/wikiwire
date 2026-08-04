---
icon: lucide/cog
---

# wikiwire.toml Reference

The `wikiwire.toml` file is the main configuration file to configure how WikiWire behaves. By default, it should be at the root level in the repository.

## version (integer)

The version of the config schema. Reserved for future use. Set to `1`.

```
version = 1
```

## shared (boolean)

Whether to enable the global shared folder or not. If set to false, WikiWire will throw an error whenever it reads the `/shared` directory of `modules/`, `templates/`, or `mediawiki/`. When enabled, content under those directories is synced to every configured site.

```
shared = false
```

## common (boolean)

Whether to enable the legacy `common` shared group folder or not. If set to false, WikiWire will throw an error whenever it reads the `/common` directory of `modules/`, `templates/`, or `mediawiki/`. When enabled, content is synced only to `[[sites]]` entries that set `common = true`.

```
common = false
```

## ignore_content_model_errors (boolean)

If true, files under `modules/`, `templates/`, or `mediawiki/` with unsupported extensions (for example `README.md`) are skipped instead of failing the sync. Scribunto files must still use `.module.lua` or `.module.luau`, however, as bare `.lua` or `.luau` extensions will always trigger an error, as will `.module.lua`/`.module.luau` files under `templates/` or `mediawiki/`.

```
ignore_content_model_errors = true
```

## delete_removed (boolean)

If true, WikiWire deletes on-wiki pages when the corresponding repo files are removed in a push diff. Also enabled when the GitHub Action input `delete_removed` is `true`. Default false.

Removing a whole site or shared directory (`modules/<host>/`, `templates/shared/`, `mediawiki/shared-lang/`, and so on, with no files left under it) is treated as a repository reorganization: those deletes are skipped with a warning. Removing individual files, including the last file of a module or subpage folder, still deletes the corresponding pages.

`sync_all: override` never performs deletes. Ignored paths are never deleted on the wiki.

Requires the bot password grant **Delete pages, revisions, and log entries**, and a wiki account with the `delete` right (often `sysop`).

```
delete_removed = true
```

## infer_page_existence (boolean)

If true, push-diff syncs (any sync job that doesn't use `sync_all`) skip the MediaWiki `page_exists` probe when GitHub reports a clear create vs modify status, roughly halving Action API round-trips per page which results in 2x speeds. Default false.

- `modified` / `changed`: edit with `nocreate` (no `contentmodel`). If the page is missing on-wiki, WikiWire retries as a create with `contentmodel`.
- `added` / `renamed` / `copied`: edit with `contentmodel` and `createonly`. If the page already exists, WikiWire retries as a plain edit.
- Deletes skip the existence probe and treat already-missing pages as a no-op.

`sync_all: override`, sibling `.module.lua` injects, and any path without a known GitHub status still use the `page_exists` probe. Fallback retries are always logged.

```
infer_page_existence = true
```

## [[sites]] (repeatable) (required)

A `[[sites]]` defines a site. At minimum one of these entries must be provided.

### id (string) (required)

Stable site key (sessions, logs). Must be unique across rows.

### host (string)

Directory name under `modules/`, `templates/`, and `mediawiki/`. If omitted, defaults to id. Must be unique across sites. Cannot be `shared` when `shared = true`, `common` when `common = true`, or any `shared-*` name because those path segments are reserved for shared site groups.

### api (string) (required)

Full MediaWiki API URL, e.g. https://example.org/w/api.php.

### dry_run (boolean)

If true, only log planned edits/deletes; no write requests for this site.

### default_branch (string)

If set, the action skips syncing when the workflow ref is not this branch (e.g. refs/heads/main).

### css_content_model (string)

Content model for `*.css` files under `modules/`, `templates/`, and `mediawiki/`. Default is `sanitized-css`. Some wikis need `css`.

### common (boolean)

If true, this site receives content from `modules/common/`, `templates/common/`, and `mediawiki/common/` when top-level `common = true`. This is also treated as membership in the `common` shared group for backward compatibility. Default false.

### shared_groups (array of strings)

Named shared site groups that this site belongs to. A path segment of the form `shared-<group>` under `modules/`, `templates/`, or `mediawiki/` syncs to every site whose `shared_groups` contains that group name.

Example:

```toml
shared_groups = ["lang", "public"]
```

## mediawiki/ layout

Most `MediaWiki:` pages are flat files directly under `mediawiki/<host|id>/`. Use a subdirectory only when a page has subpages.

| Repository path | Wiki title | Content model |
|-----------------|------------|---------------|
| `mediawiki/example.com/Common.js` | `MediaWiki:Common.js` | `javascript` |
| `mediawiki/example.com/Common.css` | `MediaWiki:Common.css` | per-site `css_content_model` |
| `mediawiki/example.com/Sitenotice.wikitext` | `MediaWiki:Sitenotice` | `wikitext` |
| `mediawiki/example.com/Sitenotice/ja` | `MediaWiki:Sitenotice/ja` | `wikitext` |

Allowed flat file names: `<page>`, `<page>.wikitext`, `<page>.js`, `<page>.css`, `<page>.json`. Subpages map 1:1 by relative path under `<page>/`. Editing these pages requires the bot password grant **Edit the MediaWiki namespace and sitewide/user JSON**.

# Configuration example

```yaml
# This is a global WikiWire configuration file, a CI action which automatically syncs and uploads modules and templates from a Git repo towards a production or upstream MediaWiki instance via bot passwords and the MediaWiki Action API.
# Learn more: https://github.com/obbywiki/wikiwire

version = 1
shared = true
common = true
ignore_content_model_errors = true

[[sites]]
id = "obbywiki"
host = "obby.wiki"
api = "https://obby.wiki/api.php"
common = true
shared_groups = ["lang"]

[[sites]]
id = "dev"
host = "dev.example.org"
api = "https://dev.example.org/w/api.php"
dry_run = true
default_branch = "main"
css_content_model = "css"
shared_groups = ["lang", "staging"]

```

With the config above, content under `modules/shared-lang/`, `templates/shared-lang/`, or `mediawiki/shared-lang/` syncs to both sites, while `modules/common/` still syncs only to sites that set `common = true`.

# GitHub Action inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `username` | no | `""` | Default bot username for sites not listed in `site_credentials`. With [Bot passwords](https://www.mediawiki.org/wiki/Manual:Bot_passwords), use `UserName@BotPasswordName`. |
| `password` | no | `""` | Default bot password for sites not listed in `site_credentials`. |
| `site_credentials` | no | `""` | JSON object whose keys are site `id` values from `wikiwire.toml` (not `host`). Each value must be `{"username":"…","password":"…"}`. Overrides the global `username` / `password` for that site. Keys that do not match any configured site produce a workflow warning. |
| `config_path` | no | `wikiwire.toml` | Path to the TOML config. |
| `ignore_path` | no | `.wikiwireignore` | Path to the ignore file (may be missing). |
| `dry_run` | no | `false` | If `true`, no edits or deletes are sent (site-level `dry_run` in TOML still applies per site). |
| `delete_removed` | no | `false` | If `true`, delete on-wiki pages when repo files are removed (also enabled by `delete_removed` in `wikiwire.toml`). Entire-folder removals are skipped. Requires special permissions. |
| `sync_all` | no | `false` | If set to `'override'`, every file under `modules/`, `templates/`, and `mediawiki/` from the workspace will be synced instead of those that changes per-commit. Requires a prior checkout of the repo. Not recommended as this may potentially be destructive. Previously this parameter accepted `true`, but that was changed in v0.3.0 |

`dark_lua_compat` was removed in WikiWire v0.3.0, and supplying it as a parameter will produce an error.

Use a workflow `permissions` block with at least `contents: read` so the default `GITHUB_TOKEN` can call the compare API.

Every site that performs a real (non-dry-run) sync must resolve to a username and password: either the global inputs or a matching entry in `site_credentials`.