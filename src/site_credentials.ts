export type SiteCredentials = { username: string; password: string };

export function parse_site_credentials(raw: string): Map<string, SiteCredentials> {
  const trimmed = raw.trim();

  if (!trimmed) return new Map();

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);

    throw new Error(`WikiWire: site_credentials is not valid JSON (${msg})`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('WikiWire: site_credentials JSON must be a non-null object');
  }

  const out = new Map<string, SiteCredentials>();

  for (const [site_id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(
        `WikiWire: site_credentials["${site_id}"] must be a JSON object with username and password`,
      );
    }

    const rec = value as Record<string, unknown>;

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
