import fs from 'node:fs';
import TOML from '@iarna/toml';

export type site_config = {
  id : string;
  api : string;
  dry_run : boolean;

  default_branch : string | null;
  css_content_model : string;
};

// toml configs arent typed

type site_entry = {
  id ?: unknown;
  api ?: unknown;
  dry_run ?: unknown;

  default_branch ?: unknown;
  css_content_model ?: unknown;
  host ?: unknown;
};


type root_config = {
  version ?: unknown;
  shared ?: unknown;
  sites ?: unknown;
};

export function load_config(config_path : string) : { schema_version : number; shared : boolean; sites : Map<string, site_config>; path_to_site : Map<string, site_config> } {
    const raw = fs.readFileSync(config_path, 'utf8');
    const data = TOML.parse(raw) as root_config;

    if (!Array.isArray(data.sites)) { throw new Error('WikiWire config error: wikiwire.toml must contain entries via [[sites]]'); };

    const sites = new Map<string, site_config>();
    const path_to_site = new Map<string, site_config>();

    const shared_enabled = Boolean(data.shared);

    for (const entry of data.sites) {
        const s = entry as site_entry;

        if (typeof s.id !== 'string' || typeof s.api !== 'string') { throw new Error('WikiWire config error: each site at minimum needs a string `id` and `api` value'); }


        const local_site_config : site_config = {
            id : s.id,
            api : s.api.trim(),

            default_branch: typeof s.default_branch === 'string' ? s.default_branch : null,
            css_content_model: typeof s.css_content_model === 'string' ? s.css_content_model : 'sanitized-css',

            dry_run : Boolean(s.dry_run)
        };


        let path_segment = s.id;
        
        if (typeof s.host !== 'string') { throw new Error(`WikiWire config error: site "${s.id}" host must be a string if set`); };

        path_segment = s.host.trim();

        if (path_segment.length === 0) { throw new Error(`WikiWire: site "${s.id}" host must not be empty`); };
        if (shared_enabled && path_segment === 'shared') { throw new Error( `WikiWire config error: site "${s.id}" cannot use path segment "shared" when shared = true (reserved for modules/shared and templates/shared)`, ); };

        if (path_to_site.has(path_segment)) {
            const other = path_to_site.get(path_segment);

            throw new Error( `WikiWire config error: duplicate repo path segment "${path_segment}" (sites "${other?.id}" and "${local_site_config.id}")`, );
        };

        sites.set(local_site_config.id, local_site_config);
        path_to_site.set(path_segment, local_site_config);
    };

    if (sites.size === 0) { throw new Error('WikiWire: wikiwire.toml must define at least one [[sites]] entry'); };

    return { 
        schema_version: typeof data.version === 'number' ? data.version : 1,
        shared: shared_enabled,
        sites,
        path_to_site
    };
};