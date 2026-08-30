# WikiWire

> [!IMPORTANT]  
> WikiWire is currently experimental. Please use cautiously and avoid potentially destructive configurations such as `sync_all` and consider testing your configurations with `dry_run`s first.

WikiWire is a GitHub Action that syncs files under `modules/`, `templates/`, and `mediawiki/` inside your Git repository into a live MediaWiki site via the [MediaWiki Action API](https://www.mediawiki.org/wiki/API:Action_API). WikiWire allows for smooth automated workflows that make your GitHub repository the primary authority over your content and seem less like a backup.

WikiWire was developed by the Obby Wiki to streamline sharing modules across not only GitHub and MediaWiki, but also across multiple wikis. While complex, it is possible to transpile Luau to Lua 5.1 and upload it via this tool, as seen in [`obbywiki/modules`](https://github.com/obbywiki/modules).

# Compatibility

| MediaWiki Version | Supported |
| ------- | ------------------ |
| MediaWiki 1.45 | :white_check_mark: Supported |
| MediaWiki 1.44 | :white_check_mark: Supported |
| MediaWiki 1.43 LTS | :white_check_mark: Supported |
| MediaWiki 1.42 | :white_check_mark: Working, not officially supported |
| MediaWiki ≤ 1.41 | :x: May work, not recommended |

Please report any bugs occurring on MW 1.43 or above.

# How to use WikiWire

WikiWire is a CI action you can add to your repository's CI as a new workflow, or integrate it into an existing workflow. If you do not already store your modules and templates inside a Git repository such as `obbywiki/modules`, you will have to [create a new repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository) in order to use WikiWire.

## Required repository layout

To get started, ensure your repository matches the correct layout that WikiWire expects. Content will not be synced unless at least one of `modules/`, `templates/`, or `mediawiki/` exists in your repository.

```sh
.
├─ modules/
│  └─ mywikidomain.org/
│     └─ MyModule
│        └─ MyModule.module.lua
└─ wikiwire.toml
└─ .wikiwireignore
```

As seen above, WikiWire expects `modules/`, `templates/`, and `mediawiki/` at the repository root. Paths outside these folders are ignored.

- **Modules:** `modules/<host|id>/<name>/...`
- **Templates:** `templates/<host|id>/<name>/...`
- **MediaWiki namespace:** `mediawiki/<host|id>/<page>.<ext>` (flat files), or `mediawiki/<host|id>/<page>/...` when a page has subpages

Nested files map to subpages: title suffixes (`.template.wikitext`, `.module.lua` / `.module.luau`, `.wikitext`) are stripped from the on-wiki title, and an index file whose basename matches its parent folder collapses (e.g. `templates/…/ArticleFlow/Group/Studio.wikitext` → `Template:ArticleFlow/Group/Studio`, `…/Group/Group.template.wikitext` → `Template:ArticleFlow/Group`). `.css` / `.js` / `.json` keep their extensions in the title.

Ideally `<host|id>` is the site’s `host` in `wikiwire.toml`, but it can also be its `id` value if no `host` is set. Using the `host` value instead removes any ambiguity and is encouraged.

> [!TIP] 
> The `shared` key is a special key that can only be used as the shared directory when enabled in `wikiwire.toml`. 
> 
> Content under `modules/shared/`, `templates/shared/`, and `mediawiki/shared/` are synced to **every** configured site. On-wiki titles are the same as for a single site (the `shared` segment is not part of the title). 
> 
> If the `shared` option is disabled or false in `wikiwire.toml`, the action will error when reading from `shared/`.
> 
> If you want to name a subfolder "shared" but don't want to trigger WikiWire, name the folder `_shared` instead. 
> Any path under `modules/`, `templates/`, or `mediawiki/` that contains a **path component starting with `_`** is skipped (not synced). Examples: `modules/_legacy/...`, `modules/example.com/MyModule/_draft/example.wikitext`, `modules/example.com/shared/_imported/...`.
>
> Shared site groups use path segments like `shared-lang` or `shared-public`. Content under `modules/shared-lang/`, `templates/shared-lang/`, and `mediawiki/shared-lang/` is synced only to sites whose `shared_groups` includes `lang`. On-wiki titles are the same as for a single site.
>
> The `common` key works like a legacy shared site group. When `common = true` in `wikiwire.toml`, content under `modules/common/`, `templates/common/`, and `mediawiki/common/` is synced only to `[[sites]]` entries that set `common = true`. On-wiki titles are the same as for a single site (the `common` segment is not part of the title). Use `common/` for things like Module:Arguments.
>
> If the `common` option is disabled or false in `wikiwire.toml`, the action will error when reading from `common/`.
>
> If you want to name a subfolder "common" or `shared-...` but don't want to trigger WikiWire, name the folder `_common` or `_shared-...` instead.


An example from the ObbyWiki's repository structure:

```text
modules/obbywiki.com/GroupLink/GroupLink.module.lua
modules/obbywiki.com/GroupLink/doc.wikitext
modules/obbywiki.com/GroupLink/styles.css
modules/obbywiki.com/GroupLink/i18n/en.json
templates/obbywiki.com/Infobox/Infobox.template.wikitext
templates/obbywiki.com/MonthNav/MonthNav.template.wikitext
templates/obbywiki.com/MonthNav/styles.css
mediawiki/obbywiki.com/Sitenotice.wikitext
mediawiki/obbywiki.com/Common.js
mediawiki/obbywiki.com/Common.css
mediawiki/obbywiki.com/Citizen.js
mediawiki/obbywiki.com/Sitenotice/ja
modules/shared/CommonUtil/CommonUtil.module.lua
modules/shared-lang/Translate/Translate.module.lua
```

You can see and use our live repository at https://github.com/obbywiki/modules for guidance.

## Configuring WikWire

Supplying a `wikiwire.toml` file under your repository is **required**. However, through action parameters, you can change that if required. To set up your first site, look below for the recommended beginner `wikiwire.toml` file:

```toml
# This is a global WikiWire configuration file, a CI action which automatically syncs and uploads modules and templates from a Git repo towards a production or upstream MediaWiki instance via bot passwords and the MediaWiki Action API.
# Learn more: https://github.com/obbywiki/wikiwire

version = 1
shared = false

[[sites]]
id = "mywiki"
host = "mywikidomain.org"
api = "https://mywikidomain.org/api.php"
default_branch = "main"
css_content_model = "css"
shared_groups = ["lang"]
```

Replace each value with what matches your wiki and verify if `api.php` is reachable for bots. Your `api.php` file may be at `/w/api.php` or some other script path instead.

Next, for consistency, add a `.wikiwireignore` into the root of your repository. You can leave this blank, but you may need it later, so keep it around. You can also ignore Luau files this way:

```
**/*.module.luau
```

## Setting up the CI workflow

> [!NOTE]
> This section of the guide only applies to repositories on GitHub. Instead, if you are not on GitHub, you may have to research how to set up a CI workflow yourself.

Begin by adding a CI file at `.github/workflows/wikiwire.yml`. Then, paste the start template below into the contents and save them:

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
      - 'mediawiki/**'
      - 'mediawiki/*'

jobs:
  wikiwire:
    runs-on: ubuntu-latest
    name: Sync files to production MediaWiki
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: obbywiki/wikiwire@latest # WikWire is pre-v1 software, consider tethering your workflow to the current latest release to avoid breaking changes
        with:
          username: WikiWireBot@BotPasswordNameHere # replace with your bot user and bot password
          password: ${{ secrets.WIKI_PASSWORD }}
          # dry_run: true # if you want to test your configs and routing first
```

This workflow assumes two things:

1. You have a user account named WikiWireBot on your wiki.
2. You have created a bot password for it and have supplied WIKI_PASSWORD to GitHub.

## How to setup a bot account and bot password

WikiWire requires a valid login in order to submit edits to your wiki.

Create a bot account on your wiki. Consider giving it the `bot` user group or even `sysop` (admin) permissions as they may be required to make edits quickly.

Next, navigate to `Special:BotPasswords` and create a bot password with the following permissions:

* Basic rights
* High-volume (bot) access
* Edit existing pages
* Edit protected pages
* Create, edit, and move pages

If you enable `delete_removed` (see configuration), also grant:

* Delete pages, revisions, and log entries

The bot account usually needs the wiki `delete` right as well (often via the `sysop` group).

You may also optionally enable:

* Edit the MediaWiki namespace and sitewide/user JSON

Enable access for every IP address (0.0.0.0/0 and ::/0) as GitHub CI often rotates IP addresses.

After creating a user account and password, edit your existing workflow and update the `username` parameter. It should look something like this:

```yaml
username: UserAcccount@BotPasswordName
```

Next, upload your bot password as a secret into your GitHub repository. For help: https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets

## Testing the workflow

After completing every step above, you should be ready to test WikiWire. Make any change to a module or a template and WikiWire should automatically sync it if everything is correct. To test your layout before actually syncing content, use the `dry_run` parameter.

### Dry-run on pull requests

A common pattern is to keep production syncs on `push` to `main`, and run WikiWire with `dry_run: true` on pull requests so contributors can verify routing and titles in CI logs without editing the wiki.

Non-`push` events do not provide commit compare data, so PR jobs must set `sync_all: override`. That walks every file under `modules/`, `templates/`, and `mediawiki/` in the checked-out workspace (not only files changed in the PR). With `dry_run: true`, WikiWire only logs planned edits and does not log in or call `action=edit`, so credentials are optional.

Add a second workflow (for example `.github/workflows/wikiwire-dry-run.yml`):

```yaml
name: WikiWire dry-run

on:
  pull_request:
    paths:
      - 'modules/**'
      - 'modules/*'
      - 'templates/**'
      - 'templates/*'
      - 'mediawiki/**'
      - 'mediawiki/*'
      - 'wikiwire.toml'
      - '.wikiwireignore'

jobs:
  wikiwire-dry-run:
    runs-on: ubuntu-latest
    name: Dry-run sync plan
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: obbywiki/wikiwire@latest
        with:
          dry_run: true
          sync_all: override
```

Successful runs log lines like `WikiWire: [dry-run] would edit Module:MyModule on mywiki <= modules/mywikidomain.org/MyModule/MyModule.module.lua`.

> [!WARNING]
> If a site sets `default_branch` in `wikiwire.toml`, WikiWire skips that site whenever `github.ref` is not `refs/heads/<default_branch>`. Pull request refs look like `refs/pull/123/merge`, so those sites will be skipped in PR dry-runs. Omit `default_branch` for sites you want validated on PRs, or rely on the workflow's `on.push.branches` filter for production syncs instead.

If you are having trouble setting up WikiWire, use our repository as a guide: https://github.com/obbywiki/modules.

Some aspects such as Cloudflare's Bot Fight Mode can interfere with the Action API. Transient HTTP 429/5xx responses and MediaWiki `ratelimited` / `maxlag` errors are waited out with capped backoff; WikiWire stops rather than forcing further writes if the wiki stays limited.

# Reference

## Errors

Most of the errors in WikiWire will be prefixed with a type.

* "WikiWire config error" -> an issue with your configuration only (wikiwire.toml, .wikiwireignore)
* "WikiWire HTTP error" -> the Action API returned a non-success HTTP status (for example 403 from Cloudflare, or a rate limit that did not recover)
* "WikiWire API error" -> there was an issue contacting the MW API
* "WikiWire content model error" -> an error with a content model (e.g., a module not under modules/)

WikiWire waits and retries on HTTP 429/502/503/504, network timeouts, and MediaWiki `ratelimited` / `maxlag` / `readonly` errors. It honors `Retry-After` when present, backs off gradually otherwise, and stops if the wiki stays limited rather than forcing further writes. Session token failures are retried after a single re-login, then fail closed. A known permanent per-page API error (for example a protected page or abuse filter) is recorded and remaining jobs continue; the Action still fails after the queue finishes. HTTP, session, rate-limit, and other account-wide errors still stop the run. Failure messages include how many jobs had already succeeded (`stopped after 7/12`, or `N pages failed after completing 11/12`).

# WikiWire Specification

For additional details, see the specification here.

## Path to wiki title mapping

| Root | Repository path | Wiki title | Content model |
|------|-------------------|------------|----------------|
| `modules` | `modules/<path_segment>/<root>/<root>.module.lua` | `Module:<root>` | `scribunto` |
| `modules` | `modules/<path_segment>/<root>/doc.wikitext` | `Module:<root>/doc` | `wikitext` |
| `modules` | `modules/<path_segment>/<root>/<nested path>` | `Module:<root>/<title path>` | See below |
| `templates` | `templates/<path_segment>/<root>/<root>.template.wikitext` | `Template:<root>` | `wikitext` |
| `templates` | `templates/<path_segment>/<root>/doc.wikitext` | `Template:<root>/doc` | `wikitext` |
| `templates` | `templates/<path_segment>/<root>/<nested path>` | `Template:<root>/<title path>` | See below |
| `mediawiki` | `mediawiki/<path_segment>/<page>.<ext>` or `<page>` | `MediaWiki:<page>` | Inferred from file name (see below) |
| `mediawiki` | `mediawiki/<path_segment>/<root>/doc.wikitext` | `MediaWiki:<root>/doc` | `wikitext` |
| `mediawiki` | `mediawiki/<path_segment>/<root>/<nested path>` | `MediaWiki:<root>/<title path>` | See below |

### Title path rules (nested files)

On-wiki titles are built from the path under `<root>/` with these rules:

1. **Strip title suffixes** from the leaf (longest match first): `.template.wikitext`, `.module.luau`, `.module.lua`, `.wikitext`. Leave `.css`, `.js`, `.json`, and extensionless basenames unchanged.
2. **Index collapse**: if the leaf (after strip) equals its parent folder name or it equals `<root>` when the file sits directly under the root folder, drop the leaf. That maps `Group/Group.wikitext` to `.../Group` and `<root>/<root>.template.wikitext` to bare `Template:<root>`.

Examples under `templates/<path_segment>/ArticleFlow/`:

| Repository path (under root) | Wiki title |
|------------------------------|------------|
| `ArticleFlow.template.wikitext` | `Template:ArticleFlow` |
| `Group/Studio.wikitext` | `Template:ArticleFlow/Group/Studio` |
| `Group/Studio.template.wikitext` | `Template:ArticleFlow/Group/Studio` |
| `Group/Group.wikitext` or `Group/Group.template.wikitext` | `Template:ArticleFlow/Group` |
| `Group/Group/Group.template.wikitext` | `Template:ArticleFlow/Group/Group` |
| `Group/styles.css` | `Template:ArticleFlow/Group/styles.css` |

The same strip + collapse rules apply under `modules/` (e.g. `Bar/Bar.module.lua` to `Module:<root>/Bar`) and nested `mediawiki/` directories (e.g. `ja.wikitext` to `MediaWiki:<root>/ja`). Asset files stay 1:1 including extensions (`i18n/en.json` to `Module:GroupLink/i18n/en.json`, `styles.css` to `Template:MonthNav/styles.css`).

Most `MediaWiki:` pages have no subpages and live as flat files directly under `mediawiki/<path_segment>/` (for example `mediawiki/example.org/Sitenotice.wikitext` to `MediaWiki:Sitenotice`, `mediawiki/example.org/Common.js` to `MediaWiki:Common.js`). When a page does have subpages, use a directory: `mediawiki/example.org/Sitenotice/ja` to `MediaWiki:Sitenotice/ja`. The nested `mediawiki/<path_segment>/<root>/<root>.<ext>` layout is also still accepted.

Templates synced to `Template:` must live under `templates/`, not `modules/`. MediaWiki namespace pages must live under `mediawiki/`. You can still use regular wikitext files under a template root like any other subpath.

Labels will be ignored on sync. Anything before the first colon (`:`) is considered a label (e.g., 'Label:Name' will simply be 'Name', which will then be synced to Module:Name because it is under the modules/ folder). This only counts for the first colon, and anything after will still be passed. This makes it easier to mark modules as imported while still syncing them.

### Content models (non-special files under `modules/`)

Suffix matching is ordered; the first match wins:

| Pattern | Content model |
|---------|----------------|
| `*.template.wikitext` | (invalid under `modules/`; fails, or skipped when `ignore_content_model_errors = true`) |
| `*.module.lua` | `scribunto` |
| `*.module.luau` | `scribunto` |
| `*.wikitext` | `wikitext` |
| `*.css` | Per-site `css_content_model` in `wikiwire.toml` (default `sanitized-css`) |
| `*.json` | `json` |
| Anything else | Error: unsupported extension (skipped when `ignore_content_model_errors = true`) |

Bare `.lua` or `.luau` extensions (without `.module.`) always error.

### Content models (non-special files under `templates/`)

Suffix matching uses the same order as under `modules/`, with one restriction: `*.module.lua` and `*.module.luau` are invalid under `templates/` (Scribunto modules must live under `modules/`). The main page is normally `<root>.template.wikitext` at `templates/<path_segment>/<root>/<root>.template.wikitext` (a bare `<root>.wikitext` at that location also maps to `Template:<root>`). Nested subpages may use either `.wikitext` or `.template.wikitext`; both strip to the same title.

| Pattern | Content model |
|---------|---------------|
| `*.module.lua` | (invalid under `templates/`; the action will fail) |
| `*.module.luau` | (invalid under `templates/`; the action will fail) |
| `*.wikitext` | `wikitext` |
| `*.css` | Per-site `css_content_model` in `wikiwire.toml` (default `sanitized-css`) |
| `*.json` | `json` |
| Anything else | Error: unsupported extension (skipped when `ignore_content_model_errors = true`) |

Bare `.lua` or `.luau` extensions (without `.module.`) always error.

Some wikis may reject certain content models on `Template:` subpages; in that case the Action API returns an error, similar to unusual `Module:` subpages.

### Content models (non-special files under `mediawiki/`)

The main page is a flat file at `mediawiki/<path_segment>/<page>.<ext>` (or extensionless `<page>` for wikitext). Content model is inferred from the file name: `.wikitext` or extensionless -> `wikitext`; page names ending in `.js` -> `javascript`; `.css` -> per-site `css_content_model`; `.json` -> `json`.

| Pattern | Content model |
|---------|----------------|
| `*.module.lua` | (invalid under `mediawiki/`; the action will fail) |
| `*.module.luau` | (invalid under `mediawiki/`; the action will fail) |
| `*.template.wikitext` | (invalid under `mediawiki/`; fails, or skipped when `ignore_content_model_errors = true`) |
| `*.wikitext` | `wikitext` |
| `*.js` | `javascript` |
| `*.css` | Per-site `css_content_model` in `wikiwire.toml` (default `sanitized-css`) |
| `*.json` | `json` |
| Extensionless basename (e.g. `ja`) | `wikitext` |
| Anything else | Error: unsupported extension (skipped when `ignore_content_model_errors = true`) |

Editing `MediaWiki:` pages requires the bot password grant **Edit the MediaWiki namespace and sitewide/user JSON**.


## Configuration: `wikiwire.toml`

Place at the repository root unless you override with the `config_path` action input.

**Did you know?** [The Better GitHub File Icons extension](https://github.com/wlft/browser-extensions-GitHubBetterFileIcons) supports wikiwire files! Both `wikiwire.toml` and `.wikiwireignore` will use the wikiwire logo!

### Top-level

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `version` | integer | no | Config schema version; default `1`. Reserved for future use. |
| `shared` | boolean | no | If true, enables `modules/shared/`, `templates/shared/`, and `mediawiki/shared/`, synced to every `[[sites]]` entry. Default false. |
| `common` | boolean | no | If true, enables `modules/common/`, `templates/common/`, and `mediawiki/common/`. Synced only to `[[sites]]` entries with `common = true`. Default false. |
| `ignore_content_model_errors` | boolean | no | If true, skip files with unsupported extensions (e.g. `README.md`) instead of failing. Bare `.lua`/`.luau` and `.module.lua`/`.module.luau` under `templates/` or `mediawiki/` still error. Default false. |
| `delete_removed` | boolean | no | If true, delete on-wiki pages when the corresponding repo files are removed in a push. Also enabled by the action input of the same name. Removing a whole site or shared directory (e.g. `modules/<host>/`) is treated as a reorganization and does **not** mass-delete every module/template underneath it. Default false. |
| `infer_page_existence` | boolean | no | If true, push-diff syncs (any sync job that doesn't use `sync_all`) skip the MediaWiki `page_exists` probe when GitHub reports a clear create vs modify status, roughly halving Action API round-trips per page which results in 2x speeds. Default false. |
| `push_attribution` | boolean | no | If true, MediaWiki edit and delete summaries on `push` events include the GitHub user who pushed and a 7-character commit SHA when available (also shown on dry-run logs). Omitted for non-`push` events. Default false. |

### `[[sites]]` (repeatable)

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `id` | string | yes | Stable site key (sessions, logs). Must be unique across rows. |
| `host` | string | no | Directory name under `modules/`, `templates/`, and `mediawiki/`. If omitted, defaults to `id`. Must be unique across sites. Cannot be `shared` when `shared = true`, `common` when `common = true`, or any `shared-*` value because those names are reserved for shared site groups. |
| `api` | string | yes | Full MediaWiki API URL, e.g. `https://example.org/w/api.php`. |
| `dry_run` | boolean | no | If true, only log planned edits/deletes; no write requests for this site. |
| `default_branch` | string | no | If set, the action skips syncing when the workflow ref is not this branch (e.g. `refs/heads/main`). |
| `css_content_model` | string | no | Content model for `*.css` files under `modules/`, `templates/`, and `mediawiki/`. Default `sanitized-css`. Some wikis need `css`. |
| `common` | boolean | no | If true, this site receives content from `modules/common/`, `templates/common/`, and `mediawiki/common/` when top-level `common = true`. Default false. |
| `shared_groups` | array of strings | no | Named shared site groups this site belongs to. A path such as `modules/shared-lang/` targets every site whose `shared_groups` contains `lang`. |

Example:

```toml
# This is a global WikiWire configuration file, a CI action which automatically syncs and uploads modules and templates from a Git repo towards a production or upstream MediaWiki instance via bot passwords and the MediaWiki Action API.
# Learn more: https://github.com/obbywiki/wikiwire

version = 1
shared = true
common = true

[[sites]]
id = "obbywiki.com"
api = "https://obbywiki.com/w/api.php"
shared_groups = ["lang", "public"]

[[sites]]
id = "dev"
host = "dev.example.org"
api = "https://dev.example.org/w/api.php"
dry_run = true
default_branch = "main"
css_content_model = "css"
common = true
shared_groups = ["lang"]
```

With this configuration:

- `modules/shared/...` syncs to every site.
- `modules/common/...` syncs only to sites with `common = true`.
- `modules/shared-lang/...` syncs only to sites with `shared_groups = ["lang", ...]`.

Credentials are **not** stored in this file. Use action inputs backed by secrets.

## `.wikiwireignore`

Optional file at the repository root (override with `ignore_path`). Patterns are relative to the repo root and follow **.gitignore** semantics (comments `#`, blank lines ignored; `**` and negation supported via the `ignore` package).

Ignored paths are skipped after change detection and never uploaded. Ignoring a path does **not** delete anything on the wiki.

Example:

```gitignore
# Legacy copies kept in git only
modules/obbywiki.com/ObbyGameInfobox/ObbyGameInfoboxLegacy.module.lua
modules/obbywiki.com/ObbyGameInfobox/ObbyGameInfoboxLegacy.template.wikitext
# It is recommended to include any file you don't want WikiWire to sync
**/*README.md
**/*requirements.txt
```

Please note that WikiWire is currently a BETA and this shouldn't be required in the future. Be advised that WikiWire doesn't support markdown or txt files, so syncing them will likely result in an error with-in your CI.

## GitHub Action inputs

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
      - 'mediawiki/**'
      - 'mediawiki/*'

jobs:
  wikiwire:
    runs-on: ubuntu-latest
    name: Sync files to production MediaWiki
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: obbywiki/wikiwire@latest
        with:
          username: WikiWireBot@BotPasswordNameHere
          password: ${{ secrets.WIKI_PASSWORD }}
```

## Limitations

- **Deletes:** Off by default. With `delete_removed` enabled (wikiwire.toml or action input), removing an individual file deletes the corresponding wiki page. Removing a whole site or shared directory (e.g. `modules/<host>/` or `templates/shared/`) is treated as a reorganization and does **not** mass-delete wiki pages. `sync_all` never deletes.
- **Renames:** Treated as deletes + adds, if enabled. Does not add a redirect.
- **Initial push:** When GitHub sends an all-zero `before` SHA, the action uses the single `push` head commit’s file list instead of `compareCommits`.
- **Branches:** Use per-site `default_branch` or workflow `on.push.branches` to avoid syncing from unintended branches.

## Releases/Builds

Contributors to WikiWire must run `pnpm install` and `pnpm build` to build the `dist/index.js` release files via esbuild.
