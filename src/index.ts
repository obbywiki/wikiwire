import * as core from '@actions/core';
import * as github from '@actions/github';
import fs from 'node:fs';
import path from 'node:path';
import ignore from 'ignore';
import type { Ignore } from 'ignore';
import { load_config, type SiteConfig } from './config';
import { map_repo_path, type MappedPath } from './paths';
import { MediaWikiSession } from './mediawiki';
import { parse_site_credentials } from './site_credentials';

type Push_payload = { after?: string; before?: string };

function is_zero_sha(sha: string | undefined): boolean {
  return !sha || /^0+$/.test(sha);
}

function walk_files(dir: string, workspace: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;

  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);

    if (ent.isDirectory()) {
      walk_files(full, workspace, out);
    } else {
      out.push(path.relative(workspace, full).split(path.sep).join('/'));
    }
  }
}

async function list_changed_paths(opts: {
  workspace: string;
  sync_all: boolean;
  ign: Ignore;
}): Promise<string[]> {
  const { workspace, sync_all, ign } = opts;
  if (sync_all) {
    const out: string[] = [];

    for (const root of ['modules', 'templates']) {
      walk_files(path.join(workspace, root), workspace, out);
    }

    return out.filter((f) => !ign.ignores(f));
  }

  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error('WikiWire: GITHUB_TOKEN is required when sync_all is false');
  }

  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const payload = github.context.payload as Push_payload;
  const after = payload.after ?? github.context.sha;
  const before = payload.before ?? '';

  let filenames: string[] = [];

  if (is_zero_sha(before)) {
    const { data } = await octokit.rest.repos.getCommit({ owner, repo, ref: after });
    filenames = (data.files ?? []).map((f) => f.filename).filter(Boolean) as string[];
  } else {
    const { data } = await octokit.rest.repos.compareCommits({
      owner,
      repo,
      base: before,
      head: after,
    });
    filenames = (data.files ?? [])
      .filter((f) => f.status !== 'removed')
      .map((f) => f.filename)
      .filter(Boolean) as string[];
  }

  return filenames.filter((f) => !ign.ignores(f));
}

type Sync_job = {
  file: string;
  mapped: MappedPath;
  site_cfg: SiteConfig;
};

async function run(): Promise<void> {
  const default_username = core.getInput('username');
  const default_password = core.getInput('password');
  const site_creds_map = parse_site_credentials(core.getInput('site_credentials') || '');
  const config_path = core.getInput('config_path') || 'wikiwire.toml';
  const ignore_path = core.getInput('ignore_path') || '.wikiwireignore';
  const input_dry = core.getInput('dry_run') === 'true';
  const sync_all = core.getInput('sync_all') === 'true';

  if (!sync_all && github.context.eventName !== 'push') {
    throw new Error(
      'WikiWire: use sync_all: true when the event is not push (e.g. workflow_dispatch)',
    );
  }

  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  const full_config = path.join(workspace, config_path);

  if (!fs.existsSync(full_config)) {
    throw new Error(`WikiWire: config not found: ${full_config}`);
  }

  const { sites, shared: shared_enabled, path_to_site } = load_config(full_config);

  for (const cred_site_id of site_creds_map.keys()) {
    if (!sites.has(cred_site_id)) {
      core.warning(
        `WikiWire: site_credentials has key "${cred_site_id}" which is not a site id in wikiwire.toml`,
      );
    }
  }

  let ign: Ignore = ignore();
  const full_ignore = path.join(workspace, ignore_path);
  if (fs.existsSync(full_ignore)) {
    ign = ign.add(fs.readFileSync(full_ignore, 'utf8'));
  }

  const changed = await list_changed_paths({ workspace, sync_all, ign });

  const jobs: Sync_job[] = [];

  for (const file of changed) {
    if (!file.startsWith('modules/') && !file.startsWith('templates/')) continue;

    const parts = file.split('/').filter(Boolean);
    if (parts.some((p) => p.startsWith('_'))) {
      core.info(`WikiWire: skip path with underscore segment ${file}`);
      continue;
    }

    const path_segment = parts[1];

    if (path_segment === 'shared') {
      if (!shared_enabled) {
        throw new Error(
          `WikiWire: ${file} uses modules/shared or templates/shared; set shared = true in wikiwire.toml or move the file under a site path`,
        );
      }

      const full_file = path.join(workspace, file);
      if (!fs.existsSync(full_file)) {
        core.info(`WikiWire: skip missing or removed file ${file}`);
        continue;
      }

      const ref = github.context.ref;

      for (const site_cfg of sites.values()) {
        if (site_cfg.default_branch && ref !== `refs/heads/${site_cfg.default_branch}`) {
          core.info(
            `WikiWire: skip ${file} for site ${site_cfg.id} (ref ${ref} is not refs/heads/${site_cfg.default_branch})`,
          );
          continue;
        }

        const mapped = map_repo_path(file, {
          css_content_model: site_cfg.css_content_model,
        });
        if (!mapped) continue;

        jobs.push({ file, mapped, site_cfg });
      }

      continue;
    }

    const site_cfg = path_to_site.get(path_segment);
    if (!site_cfg) {
      throw new Error(
        `WikiWire: unknown path segment "${path_segment}" in ${file} (add [[sites]] whose id or host matches this directory name)`,
      );
    }

    const ref = github.context.ref;
    if (site_cfg.default_branch && ref !== `refs/heads/${site_cfg.default_branch}`) {
      core.info(`WikiWire: skip ${file} (ref ${ref} is not refs/heads/${site_cfg.default_branch})`);
      continue;
    }

    const full_file = path.join(workspace, file);
    if (!fs.existsSync(full_file)) {
      core.info(`WikiWire: skip missing or removed file ${file}`);
      continue;
    }

    const mapped = map_repo_path(file, {
      css_content_model: site_cfg.css_content_model,
    });
    if (!mapped) continue;

    jobs.push({ file, mapped, site_cfg });
  }

  if (jobs.length === 0) {
    core.info('WikiWire: nothing to sync');
    return;
  }

  function credentials_for_site(site_id: string) {
    const per_site = site_creds_map.get(site_id);
    if (per_site) return per_site;
    return {
      username: default_username.trim(),
      password: default_password.trim(),
    };
  }

  const sites_needing_auth = new Set<string>();
  for (const job of jobs) {
    if (input_dry || job.site_cfg.dry_run) continue;
    sites_needing_auth.add(job.site_cfg.id);
  }

  for (const site_id of sites_needing_auth) {
    const c = credentials_for_site(site_id);
    if (!c.username || !c.password) {
      throw new Error(
        `WikiWire: missing credentials for site "${site_id}" (add it to site_credentials JSON or set global username and password inputs)`,
      );
    }
  }

  const sessions = new Map<string, MediaWikiSession>();

  async function get_session(site_id: string): Promise<MediaWikiSession> {
    const existing = sessions.get(site_id);

    if (existing) return existing;

    const cfg = sites.get(site_id);

    if (!cfg) throw new Error(`WikiWire: internal error, missing site ${site_id}`);

    const { username, password } = credentials_for_site(site_id);
    const session = new MediaWikiSession(cfg.api, username, password);

    await session.login();
    sessions.set(site_id, session);

    return session;
  }

  for (const job of jobs) {
    const dry = input_dry || job.site_cfg.dry_run;

    if (dry) {
      core.info(
        `WikiWire: [dry-run] would edit ${job.mapped.title} on ${job.site_cfg.id} <= ${job.file}`,
      );
      continue;
    }

    const session = await get_session(job.site_cfg.id);
    const text = fs.readFileSync(path.join(workspace, job.file), 'utf8');

    await session.edit(
      job.mapped.title,
      text,
      `WikiWire: sync ${job.file}`,
      job.mapped.content_model,
    );
    core.info(`WikiWire: updated ${job.mapped.title} on ${job.site_cfg.id}`);
  }
}

run().catch((err: unknown) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
