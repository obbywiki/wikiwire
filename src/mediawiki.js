// MediaWiki Action API client (login, CSRF, edit) with in-memory cookies

class MediaWikiSession {
  /**
   * @param {string} api_url full api.php URL
   * @param {string} username
   * @param {string} password
   */
  constructor(api_url, username, password) {
    this.api_url = api_url;
    this.username = username;
    this.password = password;
    this.cookies = new Map(); // Map<string, string>
    this.csrf_token = null; // string | null
  }

  /**
   * @param {Headers} headers
   */
  _merge_set_cookie(headers) {
    let list = []; // string[]

    if (typeof headers.getSetCookie === 'function') {
      list = headers.getSetCookie();
    } else {
      const sc = headers.get('set-cookie');

      if (sc) { list =  [sc] };
    }

    for (const line of list) {
      const nv = line.split(';')[0].trim();
      const eq = nv.indexOf('=');

      if (eq === -1) continue;

      const name = nv.slice(0, eq).trim();
      const value = nv.slice(eq + 1).trim();

      this.cookies.set(name, value);
    }
  }

  _cookie_header() {
    if (this.cookies.size === 0) return {};
    return {
      Cookie: [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    };
  }

  /**
   * @param {Record<string, string>} params
   */
  async _post(params) {
    const body = new URLSearchParams({ format: 'json', ...params });
    const res = await fetch(this.api_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...this._cookie_header(),
      },
      body,
    });
    this._merge_set_cookie(res.headers);
    if (!res.ok) {
      throw new Error(`WikiWire: HTTP ${res.status} from MediaWiki API`);
    }
    return (await res.json()); // Record<string, unknown>
  }

  async login() {
    let data = await this._post({ action: 'query', meta: 'tokens', type: 'login' });
    const query = (data.query); // { tokens?: { logintoken?: string } } | undefined
    let login_token = query?.tokens?.logintoken;

    if (!login_token) {
      throw new Error('WikiWire: could not get login token from MediaWiki');
    }

    data = await this._post({
      action: 'login',
      lgname: this.username,
      lgpassword: this.password,
      lgtoken: login_token,
    });

    let login = ( // { result?: string, token?: string }
      (data).login // { login?: unknown }
    );
    while (login?.result === 'NeedToken' && login.token) {
      data = await this._post({
        action: 'login',
        lgname: this.username,
        lgpassword: this.password,
        lgtoken: login.token,
      });

      login = ( // { result?: string, token?: string }
        (data).login // { login?: unknown }
      );
    }

    if (login?.result !== 'Success') {
      throw new Error(`WikiWire: MediaWiki login failed: ${JSON.stringify(login)}`);
    }

    data = await this._post({ action: 'query', meta: 'tokens', type: 'csrf' });

    const q2 = ( // { tokens?: { csrftoken?: string } }
      (data).query // { query?: unknown }
    );

    this.csrf_token = q2?.tokens?.csrftoken ?? null;

    if (!this.csrf_token) {
      throw new Error('WikiWire: could not get CSRF token from MediaWiki');
    }
  }

  /**
   * @param {string} title
   */
  async page_exists(title) {
    const data = await this._post({ action: 'query', titles: title });
    const query = ( // { pages?: Record<string, { missing?: boolean }> } | undefined
      data.query
    );
    const pages = query?.pages;
    if (!pages) return false;
    const page = Object.values(pages)[0];
    return Boolean(page && !page.missing);
  }

  /**
   * @param {string} title
   * @param {string} text
   * @param {string} summary
   * @param {string} content_model
   */
  async edit(title, text, summary, content_model) {
    if (!this.csrf_token) {
      throw new Error('WikiWire: not logged in (missing CSRF token)');
    };

    const exists = await this.page_exists(title);
    // Record<string, string>
    const params = {
      action: 'edit',
      title,
      text,
      summary,
      token: this.csrf_token,
      bot: '1',
    };

    if (!exists) {
      params.contentmodel = content_model;
    };

    const data = await this._post(params);

    if (data.error) {
      const err = /** @type {{ code?: string, info?: string }} */ (data.error);
      throw new Error(`WikiWire: edit ${title}: ${err.code ?? '?'} ${err.info ?? ''}`);
    };

    const edit = ( // { result?: string }
      (data).edit // { edit?: unknown }
    );

    if (!edit || edit.result !== 'Success') {
      throw new Error(`WikiWire: edit ${title}: unexpected response ${JSON.stringify(data)}`);
    };
  }
}

module.exports = { MediaWikiSession };
