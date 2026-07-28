---
icon: lucide/info
---

# Get started

WikiWire is a powerful CI automation tool that can automatically upload modules, templates, and MediaWiki namespace pages from your Git repositories to the live on-wiki versions in just seconds after each commit. With minimal setup, you can start syncing your GitHub repository to MediaWiki today. WikiWire is a completely free to use GitHub Action developed by the [Obby Wiki](https://obby.wiki).

## Compatibility

WikiWire is compatible with all stable MediaWiki versions, including MW 1.43 LTS.

| MediaWiki Version | Supported |
| ------- | ------------------ |
| MediaWiki 1.45 | :white_check_mark: Supported |
| MediaWiki 1.44 | :white_check_mark: Supported |
| MediaWiki 1.43 LTS | :white_check_mark: Supported |
| MediaWiki 1.42 | :white_check_mark: Working, not officially supported |
| MediaWiki ≤ 1.41 | :x: May work, not recommended |

Please report any bugs occurring on MW 1.43 or above.

## How to use WikiWire

WikiWire is a CI action you can add to your repository's CI as a new workflow, or integrate it into an existing workflow. If you do not already store your modules and templates inside a Git repository such as `obbywiki/modules`, you will have to [create a new repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository) in order to use WikiWire correctly.

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

Ideally `<host|id>` is the site’s `host` in `wikiwire.toml`, but it can also be its `id` value if no `host` is set. Using the `host` value instead removes any ambiguity and is encouraged.

!!! tip

    The `shared` key is a special key that can only be used as the shared directory when enabled in `wikiwire.toml`. 

    Content under `modules/shared/`, `templates/shared/`, and `mediawiki/shared/` are synced to **every** configured site. On-wiki titles are the same as for a single site (the `shared` segment is not part of the title). 

    If the `shared` option is disabled or false in `wikiwire.toml`, the action will error when reading from `shared/`.

    If you want to name a subfolder "shared" but don't want to trigger WikiWire, name the folder `_shared` instead. 
    Any path under `modules/`, `templates/`, or `mediawiki/` that contains a **path component starting with `_`** is skipped (not synced). Examples: `modules/_legacy/...`, `modules/example.com/MyModule/_draft/example.wikitext`, `modules/example.com/shared/_imported/...`.

    Shared site groups use path segments like `shared-lang` or `shared-public`. Content under `modules/shared-lang/`, `templates/shared-lang/`, and `mediawiki/shared-lang/` is synced only to sites whose `shared_groups` includes `lang`. On-wiki titles are the same as for a single site.

    The `common` key works like a legacy shared site group. When `common = true` in `wikiwire.toml`, content under `modules/common/`, `templates/common/`, and `mediawiki/common/` is synced only to `[[sites]]` entries that set `common = true`. On-wiki titles are the same as for a single site (the `common` segment is not part of the title).

    If the `common` option is disabled or false in `wikiwire.toml`, the action will error when reading from `common/`.

    If you want to name a subfolder "common" or `shared-...` but don't want to trigger WikiWire, name the folder `_common` or `_shared-...` instead.


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

!!! note

    This section of the guide only applies to repositories on GitHub. Instead, if you are not on GitHub, you may have to research how to set up a CI workflow yourself.

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

You may also optionally enable:

* Edit the MediaWiki namespace and sitewide/user JSON

Enable access for every IP address (0.0.0.0/0 and ::/0) as GitHub CI often rotates IP addresses.

After creating a user account and password, edit your existing workflow and update the `username` parameter. It should look something like this:

```yaml
username: UserAcccount@BotPasswordName
```

Next, upload your bot password as a secret into your GitHub repository. For help: https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets

## Testing the workflow

After completing every step above, you should be ready to test WikiWire. Make any change to a module, template, or MediaWiki configuration page and WikiWire should automatically sync it if everything is correct. To test your layout before actually syncing content, use the `dry_run` parameter.

If you are having trouble setting up WikiWire, use our repository as a guide: https://github.com/obbywiki/modules.

Some aspects such as Cloudflare's Bot Fight Mode can interfere with the Action API.