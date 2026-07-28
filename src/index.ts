import * as core from '@actions/core';
import * as github from '@actions/github';
import fs from 'node:fs';
import path from 'node:path';
import ignore from 'ignore';

import { load_config, type site_config } from './config';
import { map_repo_path, parse_shared_path_segment, type mapped_path } from './paths';
import { mw_session } from './mediawiki';
import { parse_site_credentials } from './site_credentials';

import type { Ignore } from 'ignore';

const REPO_ROOTS = ['modules', 'templates', 'mediawiki'] as const;

type push_payload = { after ?: string; before ?: string };

type sync_job = {
    file : string;
    mapped : mapped_path;
    site_cfg : site_config;
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

// sync symbling paths. e.g., if example.module.lua was genereated from example.module.luau, syncc example.module.lua
function add_sibling_lua_paths(filenames : string[], workspace : string) : string[] {
    const seen = new Set<string>();
    const out: string[] = [];

    for (const f of filenames) {
        if (!seen.has(f)) {
            seen.add(f);
            out.push(f);
        };
    };

    for (const p of filenames) {
        if (!p.startsWith('modules/') || !p.endsWith('.module.luau')) { continue };

        const sibling = p.replace(/\.module\.luau$/, '.module.lua');
        if (!fs.existsSync(path.join(workspace, sibling))) { continue };

        if (!seen.has(sibling)) {
            seen.add(sibling);
            out.push(sibling);
        };
    };

    return out;
};

async function list_changed_paths(opts : { workspace : string, sync_all : boolean; ign : Ignore }) : Promise<string[]> {
    const { workspace, sync_all, ign } = opts;

    if (sync_all) {
        const out: string[] = [];

        for (const root of REPO_ROOTS) {
            walk_files(path.join(workspace, root), workspace, out);
        };

        return out.filter((f) => !ign.ignores(f));
    };

    const token = process.env.GITHUB_TOKEN;

    if (!token) { throw new Error('WikiWire parameters error: GITHUB_TOKEN is missing'); };

    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;
    const payload = github.context.payload as push_payload;
    const after = payload.after ?? github.context.sha;
    const before = payload.before ?? '';

    let filenames : string[] = [];

    if (is_zero_sha(before)) {
        const { data } = await octokit.rest.repos.getCommit({ owner, repo, ref: after });

        filenames = (data.files ?? [])
            .map((f: { filename ?: string | null }) => f.filename)
            .filter(Boolean) as string[];
        } else {
        const { data } = await octokit.rest.repos.compareCommits({
            owner,
            repo,
            base: before,
            head: after,
        });

        filenames = (data.files ?? [])
            .filter((f: { status ?: string | null }) => f.status !== 'removed')
            .map((f: { filename ?: string | null }) => f.filename)
            .filter(Boolean) as string[];
    };

    filenames = add_sibling_lua_paths(filenames, workspace);

    return filenames.filter((f) => !ign.ignores(f));
};

async function run() : Promise<void> {
    const default_username = core.getInput('username');
    const default_password = core.getInput('password');
    const site_creds_map = parse_site_credentials(core.getInput('site_credentials') || '');
    const config_path = core.getInput('config_path') || 'wikiwire.toml';
    const ignore_path = core.getInput('ignore_path') || '.wikiwireignore';
    const input_dry = core.getInput('dry_run') === 'true';
    const sync_all = core.getInput('sync_all') === 'override';

    if (!sync_all && github.context.eventName !== 'push') { throw new Error( 'WikiWire: No context/commit data provideed. Use `sync_all: "override"` when the event is not a `push` (e.g. workflow_dispatch).', ); };

    const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
    const full_config = path.join(workspace, config_path);

    if (!fs.existsSync(full_config)) { throw new Error(`WikiWire config error: config not found: ${full_config}`); };

    const { sites, shared : shared_enabled, common : common_enabled, ignore_content_model_errors, path_to_site } = load_config(full_config);

    for (const cred_site_id of site_creds_map.keys()) {
        if (!sites.has(cred_site_id)) {
            core.warning( `WikiWire: parameter \`site_credentials\` has key "${cred_site_id}" which is not a site id listed in wikiwire.toml` );
        };
    };

    let ign : Ignore = ignore();
    const full_ignore = path.join(workspace, ignore_path);

    // collect ignores
    if (fs.existsSync(full_ignore)) {
        ign = ign.add(fs.readFileSync(full_ignore, 'utf8'));
    };

    const changed = await list_changed_paths({ workspace, sync_all, ign });

    const jobs : sync_job[] = [];

    for (const file of changed) {
        if (!REPO_ROOTS.some((root) => file.startsWith(`${root}/`))) { continue };

        const parts = file.split('/').filter(Boolean);
        if (parts.some((p) => p.startsWith('_'))) { core.info(`WikiWire: skipped path with underscore prepended: "${file}"`); continue };

        const path_segment = parts[1];

        const shared_targets = resolve_shared_targets(path_segment, sites, { shared_enabled, common_enabled });
        if (shared_targets) {
            if (shared_targets.targets.length === 0) { throw new Error(`WikiWire: ${file} uses ${parts[0]}/${path_segment}, but no configured site belongs to ${shared_targets.description}`); };

            const full_file = path.join(workspace, file);

            if (!fs.existsSync(full_file)) { core.info(`WikiWire: skip missing or removed file ${file}`); continue };

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

                jobs.push({ file, mapped, site_cfg });
            };

            continue;
        };

        const site_cfg = path_to_site.get(path_segment);
        if (!site_cfg) { throw new Error( `WikiWire: unknown path segment "${path_segment}" in ${file} (add [[sites]] whose id or host matches this directory name)` ); };

        const ref = github.context.ref;
        if (site_cfg.default_branch && ref !== `refs/heads/${site_cfg.default_branch}`) { core.info(`WikiWire: skipping ${file} (ref ${ref} is not refs/heads/${site_cfg.default_branch})`); continue };

        const full_file = path.join(workspace, file);
        if (!fs.existsSync(full_file)) { core.info(`WikiWire: skipping missing or removed file ${file}`); continue };

        const mapped = map_repo_path(file, { css_content_model: site_cfg.css_content_model, ignore_content_model_errors });
        if (!mapped) {
            if (ignore_content_model_errors) { core.info(`WikiWire: skipped ${file} (unsupported extension or placement)`); };
            continue;
        };

        jobs.push({ file, mapped, site_cfg });
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
        const session = new mw_session(cfg.api, username, password);

        await session.login();
        sessions.set(site_id, session);

        return session;
    };

    for (const job of jobs) {
        const dry = input_dry || job.site_cfg.dry_run;

        if (dry) { core.info( `WikiWire: [dry-run] would edit ${job.mapped.title} on ${job.site_cfg.id} <= ${job.file}` ); continue };

        const session = await get_session(job.site_cfg.id);
        const text = fs.readFileSync(path.join(workspace, job.file), 'utf8');

        await session.edit( job.mapped.title, text, `WikiWire: sync ${job.file}`, job.mapped.content_model );
        core.info(`WikiWire: updated ${job.mapped.title} on ${job.site_cfg.id}`);
    };
};

run().catch((err : unknown) => {
    core.setFailed(err instanceof Error ? err.message : String(err));
});
