"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const ignore_1 = __importDefault(require("ignore"));
const config_1 = require("./config");
const paths_1 = require("./paths");
const mediawiki_1 = require("./mediawiki");
const site_credentials_1 = require("./site_credentials");
function is_zero_sha(sha) {
    return !sha || /^0+$/.test(sha);
}
function walk_files(dir, workspace, out) {
    if (!node_fs_1.default.existsSync(dir))
        return;
    for (const ent of node_fs_1.default.readdirSync(dir, { withFileTypes: true })) {
        const full = node_path_1.default.join(dir, ent.name);
        if (ent.isDirectory()) {
            walk_files(full, workspace, out);
        }
        else {
            out.push(node_path_1.default.relative(workspace, full).split(node_path_1.default.sep).join('/'));
        }
    }
}
async function list_changed_paths(opts) {
    const { workspace, sync_all, ign } = opts;
    if (sync_all) {
        const out = [];
        for (const root of ['modules', 'templates']) {
            walk_files(node_path_1.default.join(workspace, root), workspace, out);
        }
        return out.filter((f) => !ign.ignores(f));
    }
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        throw new Error('WikiWire: GITHUB_TOKEN is required when sync_all is false');
    }
    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;
    const payload = github.context.payload;
    const after = payload.after ?? github.context.sha;
    const before = payload.before ?? '';
    let filenames = [];
    if (is_zero_sha(before)) {
        const { data } = await octokit.rest.repos.getCommit({ owner, repo, ref: after });
        filenames = (data.files ?? []).map((f) => f.filename).filter(Boolean);
    }
    else {
        const { data } = await octokit.rest.repos.compareCommits({
            owner,
            repo,
            base: before,
            head: after,
        });
        filenames = (data.files ?? [])
            .filter((f) => f.status !== 'removed')
            .map((f) => f.filename)
            .filter(Boolean);
    }
    return filenames.filter((f) => !ign.ignores(f));
}
async function run() {
    const default_username = core.getInput('username');
    const default_password = core.getInput('password');
    const site_creds_map = (0, site_credentials_1.parse_site_credentials)(core.getInput('site_credentials') || '');
    const config_path = core.getInput('config_path') || 'wikiwire.toml';
    const ignore_path = core.getInput('ignore_path') || '.wikiwireignore';
    const input_dry = core.getInput('dry_run') === 'true';
    const sync_all = core.getInput('sync_all') === 'true';
    if (!sync_all && github.context.eventName !== 'push') {
        throw new Error('WikiWire: use sync_all: true when the event is not push (e.g. workflow_dispatch)');
    }
    const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
    const full_config = node_path_1.default.join(workspace, config_path);
    if (!node_fs_1.default.existsSync(full_config)) {
        throw new Error(`WikiWire: config not found: ${full_config}`);
    }
    const { sites, shared: shared_enabled, path_to_site } = (0, config_1.load_config)(full_config);
    for (const cred_site_id of site_creds_map.keys()) {
        if (!sites.has(cred_site_id)) {
            core.warning(`WikiWire: site_credentials has key "${cred_site_id}" which is not a site id in wikiwire.toml`);
        }
    }
    let ign = (0, ignore_1.default)();
    const full_ignore = node_path_1.default.join(workspace, ignore_path);
    if (node_fs_1.default.existsSync(full_ignore)) {
        ign = ign.add(node_fs_1.default.readFileSync(full_ignore, 'utf8'));
    }
    const changed = await list_changed_paths({ workspace, sync_all, ign });
    const jobs = [];
    for (const file of changed) {
        if (!file.startsWith('modules/') && !file.startsWith('templates/'))
            continue;
        const parts = file.split('/').filter(Boolean);
        if (parts.some((p) => p.startsWith('_'))) {
            core.info(`WikiWire: skip path with underscore segment ${file}`);
            continue;
        }
        const path_segment = parts[1];
        if (path_segment === 'shared') {
            if (!shared_enabled) {
                throw new Error(`WikiWire: ${file} uses modules/shared or templates/shared; set shared = true in wikiwire.toml or move the file under a site path`);
            }
            const full_file = node_path_1.default.join(workspace, file);
            if (!node_fs_1.default.existsSync(full_file)) {
                core.info(`WikiWire: skip missing or removed file ${file}`);
                continue;
            }
            const ref = github.context.ref;
            for (const site_cfg of sites.values()) {
                if (site_cfg.default_branch && ref !== `refs/heads/${site_cfg.default_branch}`) {
                    core.info(`WikiWire: skip ${file} for site ${site_cfg.id} (ref ${ref} is not refs/heads/${site_cfg.default_branch})`);
                    continue;
                }
                const mapped = (0, paths_1.map_repo_path)(file, {
                    css_content_model: site_cfg.css_content_model,
                });
                if (!mapped)
                    continue;
                jobs.push({ file, mapped, site_cfg });
            }
            continue;
        }
        const site_cfg = path_to_site.get(path_segment);
        if (!site_cfg) {
            throw new Error(`WikiWire: unknown path segment "${path_segment}" in ${file} (add [[sites]] whose id or host matches this directory name)`);
        }
        const ref = github.context.ref;
        if (site_cfg.default_branch && ref !== `refs/heads/${site_cfg.default_branch}`) {
            core.info(`WikiWire: skip ${file} (ref ${ref} is not refs/heads/${site_cfg.default_branch})`);
            continue;
        }
        const full_file = node_path_1.default.join(workspace, file);
        if (!node_fs_1.default.existsSync(full_file)) {
            core.info(`WikiWire: skip missing or removed file ${file}`);
            continue;
        }
        const mapped = (0, paths_1.map_repo_path)(file, {
            css_content_model: site_cfg.css_content_model,
        });
        if (!mapped)
            continue;
        jobs.push({ file, mapped, site_cfg });
    }
    if (jobs.length === 0) {
        core.info('WikiWire: nothing to sync');
        return;
    }
    function credentials_for_site(site_id) {
        const per_site = site_creds_map.get(site_id);
        if (per_site)
            return per_site;
        return {
            username: default_username.trim(),
            password: default_password.trim(),
        };
    }
    const sites_needing_auth = new Set();
    for (const job of jobs) {
        if (input_dry || job.site_cfg.dry_run)
            continue;
        sites_needing_auth.add(job.site_cfg.id);
    }
    for (const site_id of sites_needing_auth) {
        const c = credentials_for_site(site_id);
        if (!c.username || !c.password) {
            throw new Error(`WikiWire: missing credentials for site "${site_id}" (add it to site_credentials JSON or set global username and password inputs)`);
        }
    }
    const sessions = new Map();
    async function get_session(site_id) {
        const existing = sessions.get(site_id);
        if (existing)
            return existing;
        const cfg = sites.get(site_id);
        if (!cfg)
            throw new Error(`WikiWire: internal error, missing site ${site_id}`);
        const { username, password } = credentials_for_site(site_id);
        const session = new mediawiki_1.MediaWikiSession(cfg.api, username, password);
        await session.login();
        sessions.set(site_id, session);
        return session;
    }
    for (const job of jobs) {
        const dry = input_dry || job.site_cfg.dry_run;
        if (dry) {
            core.info(`WikiWire: [dry-run] would edit ${job.mapped.title} on ${job.site_cfg.id} <= ${job.file}`);
            continue;
        }
        const session = await get_session(job.site_cfg.id);
        const text = node_fs_1.default.readFileSync(node_path_1.default.join(workspace, job.file), 'utf8');
        await session.edit(job.mapped.title, text, `WikiWire: sync ${job.file}`, job.mapped.content_model);
        core.info(`WikiWire: updated ${job.mapped.title} on ${job.site_cfg.id}`);
    }
}
run().catch((err) => {
    core.setFailed(err instanceof Error ? err.message : String(err));
});
