import * as core from '@actions/core';
import * as github from '@actions/github';
import fs from 'node:fs';
import path from 'node:path';
import ignore from 'ignore';

import { load_config, type site_config } from './config';
import { map_repo_path, parse_shared_path_segment, type mapped_path } from './paths';
import { mw_page_error, mw_session, type existence_hint } from './mediawiki';
import { parse_site_credentials } from './site_credentials';

import type { Ignore } from 'ignore';

const REPO_ROOTS = ['modules', 'templates', 'mediawiki'] as const;

type push_payload = { after ?: string; before ?: string; pusher ?: { name ?: string } };

type git_status = 'added' | 'modified' | 'changed' | 'renamed' | 'removed' | 'copied' | 'unknown';

type path_change = {
    file : string;
    kind : 'edit' | 'delete';
    git_status : git_status;
};

type sync_job = {
    file : string;
    mapped : mapped_path;
    site_cfg : site_config;
    kind : 'edit' | 'delete';
    git_status : git_status;
};

type gh_file = {
    filename ?: string | null;
    status ?: string | null;
    previous_filename ?: string | null;
};

function resolve_shared_targets(path_segment : string, sites : Map<string, site_config>, opts : { shared_enabled : boolean; common_enabled : boolean }) : { targets : site_config[]; description : string } | null {
    const parsed = parse_shared_path_segment(path_segment);
    if (!parsed) { return null };

    if (parsed.kind === 'shared') {
        if (!opts.shared_enabled) {
            throw new Error(`WikiWire: set shared = true in wikiwire.toml to use the reserved ${path_segment} directory`);
        };

        return {
            targets: Array.from(sites.values()),
            description: 'all configured sites',
        };
    };

    if (parsed.kind === 'common') {
        if (!opts.common_enabled) {
            throw new Error(`WikiWire: set common = true in wikiwire.toml to use the reserved ${path_segment} directory`);
        };

        const targets = Array.from(sites.values()).filter((site_cfg) => site_cfg.shared_groups.has('common'));
        return {
            targets,
            description: 'sites enrolled in the common shared group',
        };
    };

    const targets = Array.from(sites.values()).filter((site_cfg) => site_cfg.shared_groups.has(parsed.group_name ?? ''));
    return {
        targets,
        description: `sites enrolled in shared group "${parsed.group_name}"`,
    };
};

function is_zero_sha(sha : string | undefined) : boolean { 
    return !sha || /^0+$/.test(sha);
};

function push_attribution_suffix() : string {
    if (github.context.eventName !== 'push') { return '' };

    const payload = github.context.payload as push_payload;
    const user = payload.pusher?.name?.trim() || github.context.actor.trim();
    const sha = payload.after ?? github.context.sha;
    const short_sha = !is_zero_sha(sha) && sha.length >= 7 ? sha.slice(0, 7) : '';

    const parts = [user, short_sha].filter(Boolean);
    return parts.length ? ` (${parts.join(', ')})` : '';
};

function change_summary(kind : 'edit' | 'delete', file : string, attribution : string) : string {
    const verb = kind === 'delete' ? 'delete' : 'sync';
    return `WikiWire: ${verb} ${file}${attribution}`;
};

let sync_grouping = false;

function sync_begin(header : string) : void {
    if (sync_grouping) { core.info('') };
    core.info(`WikiWire: ${header}`);
    sync_grouping = true;
};

function sync_log(message : string) : void {
    core.info(sync_grouping ? `└─ ${message}` : `WikiWire: ${message}`);
};

function walk_files(dir : string, workspace : string, out : string[]) : void {
    if (!fs.existsSync(dir)) return;

    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);

        if (ent.isDirectory()) {
            walk_files(full, workspace, out);
        } else {
            out.push(path.relative(workspace, full).split(path.sep).join('/'));
        };
    };
};

function prefix_has_remaining_files(workspace : string, dir_rel : string) : boolean {
    const full = path.join(workspace, dir_rel);
    if (!fs.existsSync(full)) { return false };

    const found : string[] = [];
    walk_files(full, workspace, found);
    
    return found.length > 0;
};

// sync sibling paths. e.g., if example.module.lua was generated from example.module.luau, sync example.module.lua
function add_sibling_lua_edits(changes : path_change[], workspace : string) : path_change[] {
    const seen = new Set<string>();
    const out : path_change[] = [];

    for (const c of changes) {
        const key = `${c.kind}:${c.file}`;
        if (!seen.has(key)) {
            seen.add(key);
            out.push(c);
        };
    };

    for (const c of changes) {
        if (c.kind !== 'edit') { continue };
        if (!c.file.startsWith('modules/') || !c.file.endsWith('.module.luau')) { continue };

        const sibling = c.file.replace(/\.module\.luau$/, '.module.lua');
        if (!fs.existsSync(path.join(workspace, sibling))) { continue };

        const key = `edit:${sibling}`;
        if (!seen.has(key)) {
            seen.add(key);
            out.push({ file: sibling, kind: 'edit', git_status: 'unknown' });
        };
    };

    return out;
};

function normalize_git_status(status : string) : git_status {
    if ( status === 'added' || status === 'modified' || status === 'changed' || status === 'renamed' || status === 'removed' || status === 'copied' ) {
        return status;
    };

    return 'unknown';
};

function existence_hint_for(git_status : git_status, infer_page_existence : boolean) : existence_hint {
    if (!infer_page_existence) { return 'probe' };

    if (git_status === 'modified' || git_status === 'changed') { return 'assume_exists' };
    if (git_status === 'added' || git_status === 'renamed' || git_status === 'copied') { return 'assume_create' };

    return 'probe';
};

function changes_from_gh_files(files : gh_file[], delete_removed : boolean) : path_change[] {
    const out : path_change[] = [];

    for (const f of files) {
        const filename = f.filename;

        if (!filename) { continue };

        const status = f.status ?? '';
        const git_status = normalize_git_status(status);

        if (status === 'removed') {
            if (delete_removed) { out.push({ file: filename, kind: 'delete', git_status: 'removed' }) };
            continue;
        };

        if (status === 'renamed') {
            if (delete_removed && f.previous_filename) {
                out.push({ file: f.previous_filename, kind: 'delete', git_status: 'removed' });
            };

            out.push({ file: filename, kind: 'edit', git_status: 'renamed' });
            continue;
        };

        out.push({ file: filename, kind: 'edit', git_status });
    };

    return out;
};

function site_segment_dir(file : string) : string | null {
    const parts = file.split('/').filter(Boolean);

    if (parts.length < 3) { return null };
    if (!(REPO_ROOTS as readonly string[]).includes(parts[0])) { return null };

    return `${parts[0]}/${parts[1]}`;
};

function filter_reorg_deletes(delete_files : string[], workspace : string) : string[] {
    const by_segment = new Map<string, string[]>();
    const kept : string[] = [];

    for (const file of delete_files) {
        const segment_dir = site_segment_dir(file);

        if (!segment_dir) { kept.push(file); continue };

        const list = by_segment.get(segment_dir) ?? [];

        list.push(file);
        by_segment.set(segment_dir, list);
    };

    for (const [segment_dir, files] of by_segment) {
        if (!prefix_has_remaining_files(workspace, segment_dir)) {
            core.warning(`WikiWire: skipping ${files.length} delete(s) under ${segment_dir}/ (site directory removed; treating as reorg)`);
            continue;
        };

        kept.push(...files);
    };

    return kept;
};

async function list_changed_paths(opts : { workspace : string; sync_all : boolean; ign : Ignore; delete_removed : boolean }) : Promise<path_change[]> {
    const { workspace, sync_all, ign, delete_removed } = opts;

    if (sync_all) {
        const out: string[] = [];

        for (const root of REPO_ROOTS) {
            walk_files(path.join(workspace, root), workspace, out);
        };

        return out
            .filter((f) => !ign.ignores(f))
            .map((file) => ({ file, kind: 'edit' as const, git_status: 'unknown' as const }));
    };

    const token = process.env.GITHUB_TOKEN;

    if (!token) { throw new Error('WikiWire parameters error: GITHUB_TOKEN is missing'); };

    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;
    const payload = github.context.payload as push_payload;
    const after = payload.after ?? github.context.sha;
    const before = payload.before ?? '';

    let gh_files : gh_file[] = [];

    if (is_zero_sha(before)) {
        const { data } = await octokit.rest.repos.getCommit({ owner, repo, ref: after });
        gh_files = data.files ?? [];
    } else {
        const { data } = await octokit.rest.repos.compareCommits({
            owner,
            repo,
            base: before,
            head: after,
        });
        gh_files = data.files ?? [];
    };

    let changes = changes_from_gh_files(gh_files, delete_removed);
    changes = add_sibling_lua_edits(changes, workspace);

    return changes.filter((c) => !ign.ignores(c.file));
};

async function run() : Promise<void> {
    const default_username = core.getInput('username');
    const default_password = core.getInput('password');
    const site_creds_map = parse_site_credentials(core.getInput('site_credentials') || '');
    const config_path = core.getInput('config_path') || 'wikiwire.toml';
    const ignore_path = core.getInput('ignore_path') || '.wikiwireignore';
    const input_dry = core.getInput('dry_run') === 'true';
    const input_delete_removed = core.getInput('delete_removed') === 'true';
    const sync_all = core.getInput('sync_all') === 'override';

    if (!sync_all && github.context.eventName !== 'push') { throw new Error( 'WikiWire: No context/commit data provideed. Use `sync_all: "override"` when the event is not a `push` (e.g. workflow_dispatch).', ); };

    const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
    const full_config = path.join(workspace, config_path);

    if (!fs.existsSync(full_config)) { throw new Error(`WikiWire config error: config not found: ${full_config}`); };

    const { sites, shared : shared_enabled, common : common_enabled, ignore_content_model_errors, delete_removed : config_delete_removed, infer_page_existence, push_attribution, path_to_site } = load_config(full_config);
    const attribution = push_attribution ? push_attribution_suffix() : '';
    const delete_removed = input_delete_removed || config_delete_removed;

    for (const cred_site_id of site_creds_map.keys()) {
        if (!sites.has(cred_site_id)) { core.warning( `WikiWire: parameter \`site_credentials\` has key "${cred_site_id}" which is not a site id listed in wikiwire.toml` ); };
    };

    let ign : Ignore = ignore();
    const full_ignore = path.join(workspace, ignore_path);

    // collect ignores
    if (fs.existsSync(full_ignore)) {
        ign = ign.add(fs.readFileSync(full_ignore, 'utf8'));
    };

    const changed = await list_changed_paths({ workspace, sync_all, ign, delete_removed });

    const delete_candidates = changed.filter((c) => c.kind === 'delete').map((c) => c.file);
    const allowed_deletes = new Set(filter_reorg_deletes(delete_candidates, workspace));

    const jobs : sync_job[] = [];

    for (const change of changed) {
        const file = change.file;
        const kind = change.kind === 'delete' && allowed_deletes.has(file) ? 'delete' : change.kind === 'delete' ? null : 'edit';
        if (!kind) { continue };

        if (!REPO_ROOTS.some((root) => file.startsWith(`${root}/`))) { continue };

        const parts = file.split('/').filter(Boolean);
        if (parts.some((p) => p.startsWith('_'))) { core.info(`WikiWire: skipped path with underscore prepended: "${file}"`); continue };

        const path_segment = parts[1];

        const shared_targets = resolve_shared_targets(path_segment, sites, { shared_enabled, common_enabled });
        if (shared_targets) {
            if (shared_targets.targets.length === 0) { throw new Error(`WikiWire: ${file} uses ${parts[0]}/${path_segment}, but no configured site belongs to ${shared_targets.description}`); };

            const full_file = path.join(workspace, file);

            if (kind === 'edit' && !fs.existsSync(full_file)) { core.info(`WikiWire: skip missing or removed file ${file}`); continue };

            const ref = github.context.ref;

            for (const site_cfg of shared_targets.targets) {
                if (site_cfg.default_branch && ref !== `refs/heads/${site_cfg.default_branch}`) {
                    core.info( `WikiWire: skip ${file} for site ${site_cfg.id} (ref ${ref} is not refs/heads/${site_cfg.default_branch})` );
                    continue;
                };

                const mapped = map_repo_path(file, { css_content_model: site_cfg.css_content_model, ignore_content_model_errors });
                if (!mapped) {
                    if (ignore_content_model_errors) { core.info(`WikiWire: skipped ${file} (unsupported extension or placement)`); };
                    continue;
                };

                jobs.push({ file, mapped, site_cfg, kind, git_status: change.git_status });
            };

            continue;
        };

        const site_cfg = path_to_site.get(path_segment);
        if (!site_cfg) { throw new Error( `WikiWire: unknown path segment "${path_segment}" in ${file} (add [[sites]] whose id or host matches this directory name)` ); };

        const ref = github.context.ref;
        if (site_cfg.default_branch && ref !== `refs/heads/${site_cfg.default_branch}`) { core.info(`WikiWire: skipping ${file} (ref ${ref} is not refs/heads/${site_cfg.default_branch})`); continue };

        const full_file = path.join(workspace, file);
        if (kind === 'edit' && !fs.existsSync(full_file)) { core.info(`WikiWire: skipping missing or removed file ${file}`); continue };

        const mapped = map_repo_path(file, { css_content_model: site_cfg.css_content_model, ignore_content_model_errors });
        if (!mapped) {
            if (ignore_content_model_errors) { core.info(`WikiWire: skipped ${file} (unsupported extension or placement)`); };
            continue;
        };

        jobs.push({ file, mapped, site_cfg, kind, git_status: change.git_status });
    };

    if (jobs.length === 0) { core.info('WikiWire: nothing to sync'); return };

    function credentials_for_site(site_id : string) {
        const per_site = site_creds_map.get(site_id);
        if (per_site) return per_site;

        return { username: default_username.trim(), password: default_password.trim() };
    };

    const sites_needing_auth = new Set<string>();
    for (const job of jobs) {
        if (input_dry || job.site_cfg.dry_run) continue;

        sites_needing_auth.add(job.site_cfg.id);
    };

    for (const site_id of sites_needing_auth) {
        const c = credentials_for_site(site_id);

        if (!c.username || !c.password) { throw new Error( `WikiWire: missing credentials for site "${site_id}" (add it to site_credentials JSON or set global username and password inputs)` ); };
    };

    const sessions = new Map<string, mw_session>();

    async function get_session(site_id: string): Promise<mw_session> {
        const existing = sessions.get(site_id);
        if (existing) return existing;

        const cfg = sites.get(site_id);
        if (!cfg) { throw new Error(`WikiWire internal error: missing site ${site_id}`) };

        const { username, password } = credentials_for_site(site_id);
        const session = new mw_session(cfg.api, username, password, {
            log: (message) => sync_log(message),
            site_id,
        });

        await session.login();
        sessions.set(site_id, session);

        return session;
    };

    let completed = 0;
    const page_failures : { error : mw_page_error; site_id : string }[] = [];

    try {
        for (let job_index = 0; job_index < jobs.length; job_index++) {
            const job = jobs[job_index];
            const dry = input_dry || job.site_cfg.dry_run;
            const existence = existence_hint_for(job.git_status, infer_page_existence);

            try {
                if (job.kind === 'delete') {
                    if (dry) {
                        core.info( `WikiWire: [dry-run] would delete ${job.mapped.title} on ${job.site_cfg.id} <= ${job.file}${attribution}` );
                        completed += 1;
                        continue;
                    };

                    sync_begin(`syncing ${job_index + 1}/${jobs.length} delete ${job.mapped.title} on ${job.site_cfg.id}`);

                    const session = await get_session(job.site_cfg.id);
                    const deleted = await session.delete(job.mapped.title, change_summary('delete', job.file, attribution), {
                        probe: !(infer_page_existence && job.git_status === 'removed'),
                    });

                    if (deleted) {
                        sync_log(`deleted ${job.mapped.title} on ${job.site_cfg.id}`);
                    } else {
                        sync_log(`skipped delete of ${job.mapped.title} on ${job.site_cfg.id} (page already missing)`);
                    };

                    completed += 1;
                    continue;
                };

                if (dry) {
                    core.info( `WikiWire: [dry-run] would edit ${job.mapped.title} on ${job.site_cfg.id} <= ${job.file}${attribution}` );
                    completed += 1;
                    continue;
                };

                sync_begin(`syncing ${job_index + 1}/${jobs.length} edit ${job.mapped.title} on ${job.site_cfg.id}`);

                const session = await get_session(job.site_cfg.id);
                const text = fs.readFileSync(path.join(workspace, job.file), 'utf8');

                const result = await session.edit( job.mapped.title, text, change_summary('edit', job.file, attribution), job.mapped.content_model, existence );

                if (result.fallback) { sync_log( `existence inference missed for ${job.mapped.title} on ${job.site_cfg.id} (git_status=${job.git_status}); retried successfully` ); };

                sync_log(`updated ${job.mapped.title} on ${job.site_cfg.id}`);
                completed += 1;
            } catch (err : unknown) {
                if (err instanceof mw_page_error) {
                    core.error(`└─ ${err.message} on ${job.site_cfg.id}; continuing remaining jobs`);
                    page_failures.push({ error: err, site_id: job.site_cfg.id });
                    continue;
                };

                throw err;
            };
        };
    } catch (err : unknown) {
        const msg = err instanceof Error ? err.message : String(err);

        if (/\(stopped after \d+\/\d+\)$/.test(msg)) { throw err };

        if (err instanceof Error) {
            err.message = `${msg} (stopped after ${completed}/${jobs.length})`;
            throw err;
        };

        throw new Error(`${msg} (stopped after ${completed}/${jobs.length})`);
    };

    if (page_failures.length > 0) {
        const noun = page_failures.length === 1 ? 'page' : 'pages';
        const details = page_failures
            .map((failure) => `${failure.error.action} ${failure.error.title} on ${failure.site_id}: ${failure.error.code}`)
            .join('; ');

        throw new Error(`WikiWire: ${page_failures.length} ${noun} failed after completing ${completed}/${jobs.length}: ${details}`);
    };
};

run().catch((err : unknown) => {
    core.setFailed(err instanceof Error ? err.message : String(err));
});
