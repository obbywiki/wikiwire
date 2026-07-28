export type mapped_shared = {
    is_shared : true;
    title : string;
    content_model : string;
    kind : 'module' | 'template' | 'mediawiki';
};

export type mapped_site = {
    is_shared : false;
    title : string;
    content_model : string;
    kind : 'module' | 'template' | 'mediawiki';
};

export type mapped_path = mapped_shared | mapped_site;

export function parse_shared_path_segment(path_segment : string) : { kind : 'shared' | 'common' | 'group'; group_name ?: string } | null {
    if (path_segment === 'shared') {
        return { kind: 'shared' };
    };

    if (path_segment === 'common') {
        return { kind: 'common', group_name: 'common' };
    };

    if (path_segment.startsWith('shared-')) {
        const group_name = path_segment.slice('shared-'.length).trim();
        if (group_name.length === 0) { return null };

        return { kind: 'group', group_name };
    };

    return null;
};

// strips an optional repo label prefix (e.g. `imported:`, `Module:`) from a container folder name
export function wiki_name_from_root(root_name : string) : string {
    const colon = root_name.indexOf(':');
    if (colon === -1) { return root_name };

    const wiki_name = root_name.slice(colon + 1);
    if (wiki_name.length === 0) {
        throw new Error( `WikiWire: invalid root name "${root_name}" (label prefix must be followed by a wiki name). Please note that labels (Label:ModuleName) are ignored on sync.` );
    };

    return wiki_name;
};

function is_bare_lua_extension(rel_under_root : string) : boolean {
    return (
        (rel_under_root.endsWith('.lua') && !rel_under_root.endsWith('.module.lua')) ||
        (rel_under_root.endsWith('.luau') && !rel_under_root.endsWith('.module.luau'))
    );
};

function content_model_from_mediawiki_page_name(page_name : string, css_content_model : string) : string {
    if (page_name.endsWith('.js')) { return 'javascript' };
    if (page_name.endsWith('.css')) { return css_content_model };
    if (page_name.endsWith('.json')) { return 'json' };

    return 'wikitext';
};

function is_valid_mediawiki_flat_filename(filename : string) : boolean {
    if (filename.endsWith('.template.wikitext')) { return false };
    if (filename.endsWith('.wikitext')) { return true };
    if (filename.endsWith('.js')) { return true };
    if (filename.endsWith('.css')) { return true };
    if (filename.endsWith('.json')) { return true };

    return !filename.includes('.');
};

function mediawiki_page_name_from_flat_filename(filename : string) : string {
    if (filename.endsWith('.wikitext')) {
        return filename.slice(0, -'.wikitext'.length);
    };

    return filename;
};

function map_mediawiki_flat_file(filename : string, is_shared : boolean, css_content_model : string, ignore_content_model_errors : boolean, relative_path : string) : mapped_path | null {
    if (filename.endsWith('.template.wikitext')) {
        if (ignore_content_model_errors) { return null };
        throw new Error( `WikiWire: ${relative_path}: .template.wikitext belongs under templates/, not mediawiki/` );
    };

    if (!is_valid_mediawiki_flat_filename(filename)) {
        if (ignore_content_model_errors) { return null };
        throw new Error( `WikiWire content model error: unsupported mediawiki file: ${filename} (allowed: <page>, <page>.wikitext, <page>.js, <page>.css, <page>.json)` );
    };

    const wiki_name = mediawiki_page_name_from_flat_filename(filename);
    const main_page = try_map_mediawiki_main_page(wiki_name, filename, css_content_model);

    if (!main_page) {
        if (ignore_content_model_errors) { return null };
        throw new Error( `WikiWire: could not map mediawiki file: ${relative_path}` );
    };

    return {
        is_shared,
        title: main_page.title,
        content_model: main_page.content_model,
        kind: 'mediawiki',
    };
};

function try_map_mediawiki_main_page(wiki_name : string, rel_under_root : string, css_content_model : string) : { title : string; content_model : string } | null {
    if (rel_under_root === `${wiki_name}.wikitext`) {
        return { title: `MediaWiki:${wiki_name}`, content_model: 'wikitext' };
    };

    if (rel_under_root === `${wiki_name}.js`) {
        return { title: `MediaWiki:${wiki_name}`, content_model: 'javascript' };
    };

    if (rel_under_root === `${wiki_name}.css`) {
        return { title: `MediaWiki:${wiki_name}`, content_model: css_content_model };
    };

    if (rel_under_root === `${wiki_name}.json`) {
        return { title: `MediaWiki:${wiki_name}`, content_model: 'json' };
    };

    if (rel_under_root === wiki_name) {
        return {
            title: `MediaWiki:${wiki_name}`,
            content_model: content_model_from_mediawiki_page_name(wiki_name, css_content_model),
        };
    };

    return null;
};

export function content_model_for_mediawiki_subfile(rel_under_root : string, css_content_model : string, opts : { ignore_content_model_errors ?: boolean } = {}) : string | null {
    if (rel_under_root.endsWith('.module.lua') || rel_under_root.endsWith('.module.luau')) {
        throw new Error( `WikiWire content model error: ${rel_under_root}: Scribunto module files must be under modules/` );
    };

    if (rel_under_root.endsWith('.wikitext')) return 'wikitext';
    if (rel_under_root.endsWith('.js')) return 'javascript';
    if (rel_under_root.endsWith('.css')) return css_content_model;
    if (rel_under_root.endsWith('.json')) return 'json';

    if (is_bare_lua_extension(rel_under_root)) {
        throw new Error( `WikiWire content model error: ${rel_under_root}: Scribunto files must use .module.lua or .module.luau, not .lua or .luau` );
    };

    const basename = rel_under_root.split('/').pop() ?? rel_under_root;
    if (!basename.includes('.')) return 'wikitext';

    if (opts.ignore_content_model_errors) { return null };

    throw new Error( `WikiWire content model error: unsupported subfile extension: ${rel_under_root} (allowed under mediawiki/: .wikitext, .js, .css, .json, or extensionless wikitext subpages)` );
};

export function content_model_for_repo_subfile(rel_under_root : string, css_content_model : string, opts : { allow_scribunto : boolean; ignore_content_model_errors ?: boolean }) : string | null {
    if (opts.allow_scribunto) {
        // any more cases and this should be a switch
        if (rel_under_root.endsWith('.module.lua')) return 'scribunto';
        if (rel_under_root.endsWith('.module.luau')) return 'scribunto';
    } else {
        if (rel_under_root.endsWith('.module.lua') || rel_under_root.endsWith('.module.luau')) { throw new Error( `WikiWire content model error: ${rel_under_root}: Scribunto module files must be under modules/` ); };
    };

    if (rel_under_root.endsWith('.wikitext')) return 'wikitext';
    if (rel_under_root.endsWith('.css')) return css_content_model;
    if (rel_under_root.endsWith('.json')) return 'json';

    if (is_bare_lua_extension(rel_under_root)) {
        throw new Error( `WikiWire content model error: ${rel_under_root}: Scribunto files must use .module.lua or .module.luau, not .lua or .luau` );
    };

    if (opts.ignore_content_model_errors) { return null };

    throw new Error( `WikiWire content model error: unsupported subfile extension: ${rel_under_root} (allowed: .module.lua, .module.luau, .wikitext, .css, .json). *.module.lua/*.module.luau files are only allowed under modules/)`, );
}

export function map_repo_path(relative_path : string, options: { css_content_model ?: string; ignore_content_model_errors ?: boolean } = {}) : mapped_path | null {
    const css_content_model = options.css_content_model ?? 'sanitized-css';
    const ignore_content_model_errors = options.ignore_content_model_errors ?? false;
    const normalized = relative_path.replace(/\\/g, '/').replace(/^\/+/, '');

    const parts = normalized.split('/').filter(Boolean);
    if (parts.length === 0) { return null };

    const root = parts[0];
    if (root !== 'modules' && root !== 'templates' && root !== 'mediawiki') { return null };

    const path_segment = parts[1];
    const is_shared = parse_shared_path_segment(path_segment) !== null;

    if (root === 'mediawiki' && parts.length === 3) {
        return map_mediawiki_flat_file(parts[2], is_shared, css_content_model, ignore_content_model_errors, relative_path);
    };

    if (parts.length < 4) {
        const expected = root === 'mediawiki'
            ? `${root}/<path_segment>/<file> or ${root}/<path_segment>/<root_name>/<file>`
            : `${root}/<path_segment>/<root_name>/<file>`;
        throw new Error( `WikiWire: path too shallow (need ${expected}): ${relative_path}` );
    };

    const root_name = parts[2];
    const wiki_name = wiki_name_from_root(root_name);
    const rest = parts.slice(3);
    const rel_under_root = rest.join('/');

    if (root === 'modules') {
        if (rel_under_root.endsWith('.template.wikitext')) {
            if (ignore_content_model_errors) { return null };
            throw new Error( `WikiWire: ${relative_path}: .template.wikitext belongs under templates/, not modules/` );
        };

        if (rel_under_root === `${wiki_name}.module.lua` || rel_under_root === `${wiki_name}.module.luau`) {
            return {
                is_shared,
                title: `Module:${wiki_name}`,
                content_model: 'scribunto',
                kind: 'module',
            };
        };

        if (rel_under_root === 'doc.wikitext') {
            return {
                is_shared,
                title: `Module:${wiki_name}/doc`,
                content_model: 'wikitext',
                kind: 'module',
            };
        };

        const content_model = content_model_for_repo_subfile(rel_under_root, css_content_model, {
            allow_scribunto: true,
            ignore_content_model_errors,
        });

        if (content_model === null) { return null };

        return {
            is_shared,
            title: `Module:${wiki_name}/${rel_under_root}`,
            content_model,
            kind: 'module',
        };
    };

    if (root === 'templates') {
        if (rel_under_root === `${wiki_name}.template.wikitext`) {
            return {
                is_shared,
                title: `Template:${wiki_name}`,
                content_model: 'wikitext',
                kind: 'template',
            };
        }

        if (rel_under_root === 'doc.wikitext') {
            return {
                is_shared,
                title: `Template:${wiki_name}/doc`,
                content_model: 'wikitext',
                kind: 'template',
            };
        }

        const content_model = content_model_for_repo_subfile(rel_under_root, css_content_model, {
            allow_scribunto: false,
            ignore_content_model_errors,
        });

        if (content_model === null) { return null };

        return {
            is_shared,
            title: `Template:${wiki_name}/${rel_under_root}`,
            content_model,
            kind: 'template',
        };
    };

    // only other root possible is 'mediawiki'

    if (rel_under_root.endsWith('.template.wikitext')) {
        if (ignore_content_model_errors) { return null };
        throw new Error( `WikiWire: ${relative_path}: .template.wikitext belongs under templates/, not mediawiki/` );
    };

    const main_page = try_map_mediawiki_main_page(wiki_name, rel_under_root, css_content_model);
    if (main_page) {
        return {
            is_shared,
            title: main_page.title,
            content_model: main_page.content_model,
            kind: 'mediawiki',
        };
    }

    if (rel_under_root === 'doc.wikitext') {
        return {
            is_shared,
            title: `MediaWiki:${wiki_name}/doc`,
            content_model: 'wikitext',
            kind: 'mediawiki',
        };
    }

    const content_model = content_model_for_mediawiki_subfile(rel_under_root, css_content_model, {
        ignore_content_model_errors,
    });

    if (content_model === null) { return null };

    return {
        is_shared,
        title: `MediaWiki:${wiki_name}/${rel_under_root}`,
        content_model,
        kind: 'mediawiki',
    };
};

export function content_model_for_module_subfile(rel_under_root : string, css_content_model : string) : string | null {
    return content_model_for_repo_subfile(rel_under_root, css_content_model, { allow_scribunto: true });
};
