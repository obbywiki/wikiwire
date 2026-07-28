---
icon: lucide/git-pull-request-arrow
---

# Pull Requests

A common pattern is to keep production syncs on `push` to `main`, and run WikiWire with `dry_run: true` on pull requests so contributors can verify routing and titles in CI logs without editing the wiki.

Non-`push` events do not provide commit compare data, so PR jobs must set `sync_all: override`. That walks every file under `modules/`, `templates/`, and `mediawiki/` in the checked-out workspace (not only files changed in the PR). With `dry_run: true`, WikiWire only logs planned edits and does not log in or call `action=edit`, so credentials are optional.

Add a second workflow (for example `.github/workflows/wikiwire-dry-run.yml`):

```yaml
# wikiwire-pr.yml

name: WikiWire Dry-run

on:
  pull_request:
    paths:
      - 'modules/**'
      - 'modules/*'
      - 'templates/**'
      - 'templates/*'
      - 'mediawiki/**'
      - 'mediawiki/*'

jobs:
  wikiwire-dry-run:
    runs-on: ubuntu-latest
    name: WikiWire Dry-run
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

!!! warning

    If a site sets `default_branch` in `wikiwire.toml`, WikiWire skips that site whenever `github.ref` is not `refs/heads/<default_branch>`. Pull request refs look like `refs/pull/123/merge`, so those sites will be skipped in PR dry-runs. Omit `default_branch` for sites you want validated on PRs, or rely on the workflow's `on.push.branches` filter for production syncs instead.