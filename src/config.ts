import fs from 'node:fs';
import TOML from '@iarna/toml';

export type site_config = {
  id : string;
  api : string;
  dry_run : boolean;

  default_branch : string | null;
  css_content_model : string;
  common : boolean;
  shared_groups : Set<string>;
};

// toml configs arent typed

type site_entry = {
  id ?: unknown;
  api ?: unknown;
  dry_run ?: unknown;

  default_branch ?: unknown;
  css_content_model ?: unknown;
  host ?: unknown;
  common ?: unknown;
  shared_groups ?: unknown;
};


type root_config = {
  version ?: unknown;
  shared ?: unknown;
  common ?: unknown;
  ignore_content_model_errors ?: unknown;
  delete_removed ?: unknown;
  infer_page_existence ?: unknown;
  sites ?: unknown;
};

export function load_config(config_path : string) : { schema_version : number; shared : boolean; common : boolean; ignore_content_model_errors : boolean; delete_removed : boolean; infer_page_existence : boolean; sites : Map<string, site_config>; path_to_site : Map<string, site_config> } {
    const raw = fs.readFileSync(config_path, 'utf8');
    const data = TOML.parse(raw) as root_config;

    if (!Array.isArray(data.sites)) { throw new Error('WikiWire config error: wikiwire.toml must contain entries via [[sites]]'); };

    const sites = new Map<string, site_config>();
    const path_to_site = new Map<string, site_config>();

    const shared_enabled = Boolean(data.shared);
    const common_enabled = Boolean(data.common);

    for (const entry of data.sites) {
        const s = entry as site_entry;

        if (typeof s.id !== 'string' || typeof s.api !== 'string') { throw new Error('WikiWire config error: each site at minimum needs a string `id` and `api` value'); }


        const shared_groups = new Set<string>();
        if (s.shared_groups !== undefined) {
            if (!Array.isArray(s.shared_groups)) { throw new Error(`WikiWire config error: site "${s.id}" shared_groups must be an array of strings if set`); };

            for (const raw_group of s.shared_groups) {
                if (typeof raw_group !== 'string') { throw new Error(`WikiWire config error: site "${s.id}" shared_groups must contain only strings`); };

                const group_name = raw_group.trim();
                if (group_name.length === 0) { throw new Error(`WikiWire config error: site "${s.id}" shared_groups entries must not be empty`); };

                shared_groups.add(group_name);
            };
        };

        const common = Boolean(s.common);
        if (common) {
            shared_groups.add('common');
        };

        const local_site_config : site_config = {
            id : s.id,
            api : s.api.trim(),

            default_branch: typeof s.default_branch === 'string' ? s.default_branch : null,
            css_content_model: typeof s.css_content_model === 'string' ? s.css_content_model : 'sanitized-css',

            dry_run : Boolean(s.dry_run),
            common,
            shared_groups,
        };


        let path_segment = s.id;
        
        if (typeof s.host !== 'string') { throw new Error(`WikiWire config error: site "${s.id}" host must be a string if set`); };

        path_segment = s.host.trim();

        if (path_segment.length === 0) { throw new Error(`WikiWire: site "${s.id}" host must not be empty`); };
        if (shared_enabled && path_segment === 'shared') { throw new Error( `WikiWire config error: site "${s.id}" cannot use path segment "shared" when shared = true (reserved for modules/shared, templates/shared, and mediawiki/shared)`, ); };
        if (common_enabled && path_segment === 'common') { throw new Error( `WikiWire config error: site "${s.id}" cannot use path segment "common" when common = true (reserved for modules/common, templates/common, and mediawiki/common)`, ); };
        if (/^shared-.+/.test(path_segment)) { throw new Error( `WikiWire config error: site "${s.id}" cannot use path segment "${path_segment}" because shared site groups reserve all "shared-*" directory names`, ); };

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
        common: common_enabled,
        ignore_content_model_errors: Boolean(data.ignore_content_model_errors),
        delete_removed: Boolean(data.delete_removed),
        infer_page_existence: Boolean(data.infer_page_existence),
        sites,
        path_to_site
    };
};