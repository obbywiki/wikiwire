# WikiWire

> [!IMPORTANT]  
> WikiWire is currently experimental. Please use cautiously and avoid potentially destructive configurations such as `sync_all` and consider testing your configurations with `dry_run`s first.

WikiWire is a GitHub Action that syncs files under `modules/` and `templates/` inside your Git repository into a live MediaWiki site via the [MediaWiki Action API](https://www.mediawiki.org/wiki/API:Action_API). WikiWire allows for smooth automated workflows that make your GitHub repository the primary authority over your content and seem less like a backup.

# Compatibility Matrix

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

To get started, ensure your repository matches the correct layout that WikiWire expects. Content will not be synced if neither a `modules/` nor a `templates/` folder is found in your repository.

```sh
.
├─ modules/
│  └─ mywikidomain.org/
│     └─ MyModule
│        └─ MyModule.module.lua
└─ wikiwire.toml
└─ .wikiwireignore
```

As seen above, WikiWire expects and *requires* that `modules/` and `templates/` are stored under the root level of the repository, or they will be ignored.

- **Modules:** `modules/<host|id>/<name>/...`
- **Templates:** `templates/<host|id>/<name>/...`

Ideally `<host|id>` is the site’s `host` in `wikiwire.toml`, but it can also be its `id` value if no `host` is set. Using the `host` value instead removes any ambiguity and is encouraged.

> [!TIP] 
> The `shared` key is a special key that can only be used as the shared directory when enabled in `wikiwire.toml`. 
> 
> Content under `modules/shared/` and `templates/shared/` are synced to **every** configured site. On-wiki titles are the same as for a single site (the `shared` segment is not part of the title). 
> 
> If the `shared` option is disabled or false in `wikiwire.toml`, the action will error when reading from `shared/`.
> 
> If you want to name a subfolder "shared" but don't want to trigger WikiWire, name the folder `_shared` instead. 
> Any path under `modules/` or `templates/` that contains a **path component starting with `_`** is skipped (not synced). Examples: `modules/_legacy/...`, `modules/example.com/MyModule/_draft/example.wikitext`, `modules/example.com/shared/_imported/...`.


An example from the ObbyWiki's repository structure:

```text
modules/obbywiki.com/GroupLink/GroupLink.module.lua
modules/obbywiki.com/GroupLink/doc.wikitext
modules/obbywiki.com/GroupLink/styles.css
modules/obbywiki.com/GroupLink/i18n/en.json
templates/obbywiki.com/Infobox/Infobox.template.wikitext
templates/obbywiki.com/MonthNav/MonthNav.template.wikitext
templates/obbywiki.com/MonthNav/styles.css
modules/shared/CommonUtil/CommonUtil.module.lua
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

If you are having trouble setting up WikiWire, use our repository as a guide: https://github.com/obbywiki/modules.

Some aspects such as Cloudflare's Bot Fight Mode can interfere with the Action API.

# WikiWire Specification

For additional details, see the specification here.

## Path to wiki title mapping

| Root | Repository path | Wiki title | Content model |
|------|-------------------|------------|----------------|
| `modules` | `modules/<path_segment>/<root>/<root>.module.lua` | `Module:<root>` | `scribunto` |
| `modules` | `modules/<path_segment>/<root>/doc.wikitext` | `Module:<root>/doc` | `wikitext` |
| `modules` | `modules/<path_segment>/<root>/<any other path>` | `Module:<root>/<any other path>` | See below |
| `templates` | `templates/<path_segment>/<root>/<root>.template.wikitext` | `Template:<root>` | `wikitext` |
| `templates` | `templates/<path_segment>/<root>/doc.wikitext` | `Template:<root>/doc` | `wikitext` |
| `templates` | `templates/<path_segment>/<root>/<any other path>` | `Template:<root>/<any other path>` | See below |

Any other file under `modules/<path_segment>/<root>/` maps 1:1: the wiki subpage path is exactly the relative path under `<root>/`, including nested directories (for example `i18n/en.json` becomes `Module:GroupLink/i18n/en.json`).

The same 1:1 rule applies under `templates/<path_segment>/<root>/` for every path except the main `<root>.template.wikitext` (which maps to the bare `Template:<root>`) and `doc.wikitext` (which maps to `Template:<root>/doc`). For example `styles.css` becomes `Template:MonthNav/styles.css`.

Templates synced to `Template:` must live under `templates/`, not `modules/`. You can still use regular wikitext files under a template root like any other subpath.

### Content models (non-special files under `modules/`)

Suffix matching is ordered; the first match wins:

| Pattern | Content model |
|---------|----------------|
| `*.template.wikitext` | (invalid under `modules/`; the action will fail) |
| `*.module.lua` | `scribunto` |
| `*.module.luau` | `scribunto` |
| `*.wikitext` | `wikitext` |
| `*.css` | Per-site `css_content_model` in `wikiwire.toml` (default `sanitized-css`) |
| `*.json` | `json` |
| Anything else | Error: unsupported extension |

(**TODO**: these should be ignored instead, such as README.md)

### Content models (non-special files under `templates/`)

Suffix matching uses the same order as under `modules/`, with one restriction: `*.module.lua` and `*.module.luau` are invalid under `templates/` (Scribunto modules must live under `modules/`). The main page must be `<root>.template.wikitext` at `templates/<path_segment>/<root>/<root>.template.wikitext`.

| Pattern | Content model |
|---------|---------------|
| `*.module.lua` | (invalid under `templates/`; the action will fail) |
| `*.module.luau` | (invalid under `templates/`; the action will fail) |
| `*.wikitext` | `wikitext` |
| `*.css` | Per-site `css_content_model` in `wikiwire.toml` (default `sanitized-css`) |
| `*.json` | `json` |
| Anything else | Error: unsupported extension |

Some wikis may reject certain content models on `Template:` subpages; in that case the Action API returns an error, similar to unusual `Module:` subpages.


## Configuration: `wikiwire.toml`

Place at the repository root unless you override with the `config_path` action input.

**Did you know?** [The Better GitHub File Icons extension](https://github.com/wlft/browser-extensions-GitHubBetterFileIcons) supports wikiwire files! Both `wikiwire.toml` and `.wikiwireignore` will use the wikiwire logo!

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
| `css_content_model` | string | no | Content model for `*.css` files under `modules/` and `templates/`. Default `sanitized-css`. Some wikis need `css`. |

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
| `dry_run` | no | `false` | If `true`, no edits are sent (site-level `dry_run` in TOML still applies per site). |
| `sync_all` | no | `false` | If set to `'override'`, every file under `modules/` and `templates/` from the workspace will be synced instead of those that changes per-commit. Requires a prior checkout of the repo. Not recommended as this may potentially be destructive. Previously this parameter accepted `true`, but that was changed in v0.3.0 |

`dark_lua_compat` was removed in WikiWire v0.3.0, and supplying it as a parameter will produce an error.

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

- **Deletes:** Removing a file from git does **not** delete the wiki page.
- **Renames:** Appear as delete + add; see deletes.
- **Initial push:** When GitHub sends an all-zero `before` SHA, the action uses the single `push` head commit’s file list instead of `compareCommits`.
- **Branches:** Use per-site `default_branch` or workflow `on.push.branches` to avoid syncing from unintended branches.

## Releases/Builds

Contributors to WikiWire must run `pnpm install` and `pnpm build` to build the `dist/index.js` release files via esbuild.
