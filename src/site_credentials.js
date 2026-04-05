/**
 * @param {string} raw
 * @returns {Map<string, { username: string, password: string }>}
 */
function parse_site_credentials(raw) {
  const trimmed = raw.trim();

  if (!trimmed) return new Map();

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);

    throw new Error(`WikiWire: site_credentials is not valid JSON (${msg})`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('WikiWire: site_credentials JSON must be a non-null object');
  }

  const out = new Map(); // Map<string, { username: string, password: string }>

  for (const [site_id, value] of Object.entries(parsed)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(
        `WikiWire: site_credentials["${site_id}"] must be a JSON object with username and password`,
      );
    }

    const rec = (value); // Record<string, unknown>
    
    if (typeof rec.username !== 'string' || typeof rec.password !== 'string') {
      throw new Error(
        `WikiWire: site_credentials["${site_id}"] must have string username and password`,
      );
    }

    const username = rec.username.trim();
    const password = rec.password.trim();

    if (!username || !password) {
      throw new Error(
        `WikiWire: site_credentials["${site_id}"] must have non-empty username and password`,
      );
    }

    out.set(site_id, { username, password });
  }

  return out;
}

module.exports = { parse_site_credentials };
