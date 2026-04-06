import fs from 'node:fs';
import TOML from '@iarna/toml';

export type SiteConfig = {
  id: string;
  api: string;
  dry_run: boolean;
  default_branch: string | null;
  css_content_model: string;
};

type TomlSiteEntry = {
  id?: unknown;
  api?: unknown;
  dry_run?: unknown;
  default_branch?: unknown;
  css_content_model?: unknown;
  host?: unknown;
};

type TomlRoot = {
  version?: unknown;
  shared?: unknown;
  sites?: unknown;
};

export function load_config(config_path: string): {
  version: number;
  shared: boolean;
  sites: Map<string, SiteConfig>;
  path_to_site: Map<string, SiteConfig>;
} {
  const raw = fs.readFileSync(config_path, 'utf8');
  const data = TOML.parse(raw) as TomlRoot;

  if (!Array.isArray(data.sites)) {
    throw new Error('WikiWire: wikiwire.toml must contain [[sites]] entries');
  }

  const shared = Boolean(data.shared);

  const sites = new Map<string, SiteConfig>();
  const path_to_site = new Map<string, SiteConfig>();

  for (const entry of data.sites) {
    const s = entry as TomlSiteEntry;

    if (typeof s.id !== 'string' || typeof s.api !== 'string') {
      throw new Error('WikiWire: each site needs string id and api');
    }

    const site_cfg: SiteConfig = {
      id: s.id,
      api: s.api.trim(),
      dry_run: Boolean(s.dry_run),
      default_branch: typeof s.default_branch === 'string' ? s.default_branch : null,
      css_content_model:
        typeof s.css_content_model === 'string' ? s.css_content_model : 'sanitized-css',
    };

    let path_segment = s.id;
    if (s.host !== undefined && s.host !== null) {
      if (typeof s.host !== 'string') {
        throw new Error(`WikiWire: site "${s.id}" host must be a string if set`);
      }
      path_segment = s.host.trim();
      if (path_segment.length === 0) {
        throw new Error(`WikiWire: site "${s.id}" host must not be empty`);
      }
    }

    if (shared && path_segment === 'shared') {
      throw new Error(
        `WikiWire: site "${s.id}" cannot use path segment "shared" when shared = true (reserved for modules/shared and templates/shared)`,
      );
    }

    if (path_to_site.has(path_segment)) {
      const other = path_to_site.get(path_segment);
      throw new Error(
        `WikiWire: duplicate repo path segment "${path_segment}" (sites "${other?.id}" and "${site_cfg.id}")`,
      );
    }

    sites.set(site_cfg.id, site_cfg);
    path_to_site.set(path_segment, site_cfg);
  }

  if (sites.size === 0) {
    throw new Error('WikiWire: wikiwire.toml must define at least one [[sites]] entry');
  }

  return {
    version: typeof data.version === 'number' ? data.version : 1,
    shared,
    sites,
    path_to_site,
  };
}
