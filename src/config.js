const fs = require('node:fs');
const TOML = require('@iarna/toml');

/**
 * @param {string} config_path
 * @returns {{ version: number, sites: Map<string, { id: string, api: string, dry_run: boolean, default_branch: string | null, css_content_model: string }> }}
 */
function load_config(config_path) {
  const raw = fs.readFileSync(config_path, 'utf8');
  const data = (TOML.parse(raw)); // Record<string, unknown>

  if (!Array.isArray(data.sites)) {
    throw new Error('WikiWire: wikiwire.toml must contain [[sites]] entries');
  };

  // Map<string, { id: string, api: string, dry_run: boolean, default_branch: string | null, css_content_model: string }>
  const sites = new Map();
  for (const entry of data.sites) {
    const s = (entry); // Record<string, unknown>

    if (typeof s.id !== 'string' || typeof s.api !== 'string') {
      throw new Error('WikiWire: each site needs string id and api');
    };

    sites.set(s.id, {
      id: s.id,
      api: s.api.trim(),
      dry_run: Boolean(s.dry_run),
      default_branch: typeof s.default_branch === 'string' ? s.default_branch : null,
      css_content_model:
        typeof s.css_content_model === 'string' ? s.css_content_model : 'sanitized-css',
    });
  };

  if (sites.size === 0) {
    throw new Error('WikiWire: wikiwire.toml must define at least one [[sites]] entry');
  };

  return { version: typeof data.version === 'number' ? data.version : 1, sites };
}

module.exports = { load_config };
