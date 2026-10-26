---
icon: lucide/cog
---

# .wikiwireignore Reference

Optional file at the repository root (override with `ignore_path`). Patterns are relative to the repo root and follow **.gitignore** semantics (comments `#`, blank lines ignored; `**` and negation supported via the `ignore` package). If `src = true` in `wikiwire.toml`, ignore paths under `src/modules/`, `src/templates/`, and so on.

Ignored paths are skipped after change detection and never uploaded. Ignoring a path does **not** delete anything on the wiki.

Example:

```gitignore
# Legacy copies kept in git only
modules/obbywiki.com/ObbyGameInfobox/ObbyGameInfoboxLegacy.module.lua
modules/obbywiki.com/ObbyGameInfobox/ObbyGameInfoboxLegacy.template.wikitext
mediawiki/obbywiki.com/Common.js
# It is recommended to include any file you don't want WikiWire to sync (or attempt to sync)
**/*README.md
**/*requirements.txt
```