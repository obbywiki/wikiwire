"use strict";
// MediaWiki Action API client (login, CSRF, edit) with in-memory cookies
Object.defineProperty(exports, "__esModule", { value: true });
exports.MediaWikiSession = void 0;
const WIKIWIRE_UA = 'WikiWire/1.0';
function api_url_for_log(api_url) {
    try {
        const u = new URL(api_url);
        return `${u.origin}${u.pathname}`;
    }
    catch {
        return '(invalid api URL)';
    }
}
function summarize_error_body(text, max_len) {
    const one_line = text.trim().replace(/\s+/g, ' ');
    const is_html = /^\s*</.test(text) || /<html[\s>]/i.test(text.slice(0, 200));
    const prefix = is_html ? 'body looks like HTML (WAF, proxy, or custom error page): ' : 'body: ';
    if (one_line.length <= max_len)
        return prefix + one_line;
    return prefix + `${one_line.slice(0, max_len)}…`;
}
function get_set_cookie_lines(headers) {
    const h = headers;
    if (typeof h.getSetCookie === 'function') {
        return h.getSetCookie();
    }
    const sc = headers.get('set-cookie');
    return sc ? [sc] : [];
}
class MediaWikiSession {
    api_url;
    username;
    password;
    cookies;
    csrf_token;
    constructor(api_url, username, password) {
        this.api_url = api_url;
        this.username = username;
        this.password = password;
        this.cookies = new Map();
        this.csrf_token = null;
    }
    _merge_set_cookie(headers) {
        const list = get_set_cookie_lines(headers);
        for (const line of list) {
            const nv = line.split(';')[0].trim();
            const eq = nv.indexOf('=');
            if (eq === -1)
                continue;
            const name = nv.slice(0, eq).trim();
            const value = nv.slice(eq + 1).trim();
            this.cookies.set(name, value);
        }
    }
    _cookie_header() {
        if (this.cookies.size === 0)
            return {};
        return {
            Cookie: [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
        };
    }
    async _post(params) {
        const body = new URLSearchParams({ format: 'json', ...params });
        const action = typeof params.action === 'string' ? params.action : '?';
        const res = await fetch(this.api_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': WIKIWIRE_UA,
                ...this._cookie_header(),
            },
            body,
        });
        this._merge_set_cookie(res.headers);
        if (!res.ok) {
            const detail = await res.text();
            const bits = [
                `HTTP ${res.status} ${res.statusText}`,
                `action=${action}`,
                `api=${api_url_for_log(this.api_url)}`,
            ];
            const cf_ray = res.headers.get('cf-ray');
            if (cf_ray)
                bits.push(`cf-ray=${cf_ray}`);
            const www_auth = res.headers.get('www-authenticate');
            if (www_auth)
                bits.push(`www-authenticate=${www_auth}`);
            const server = res.headers.get('server');
            if (server)
                bits.push(`server=${server}`);
            const body_note = summarize_error_body(detail, 400);
            let hint = '';
            if (res.status === 403) {
                hint =
                    ' (403 usually means the HTTP layer blocked the request—wrong URL, bot/WAF rules, IP allowlist, or missing Host/HTTPS—not a MediaWiki API error code.)';
            }
            throw new Error(`WikiWire: ${bits.join('; ')}. ${body_note}${hint}`);
        }
        return (await res.json());
    }
    async login() {
        let data = await this._post({ action: 'query', meta: 'tokens', type: 'login' });
        const query = data.query;
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
        let login = data.login;
        while (login?.result === 'NeedToken' && login.token) {
            data = await this._post({
                action: 'login',
                lgname: this.username,
                lgpassword: this.password,
                lgtoken: login.token,
            });
            login = data.login;
        }
        if (login?.result !== 'Success') {
            throw new Error(`WikiWire: MediaWiki login failed: ${JSON.stringify(login)}`);
        }
        data = await this._post({ action: 'query', meta: 'tokens', type: 'csrf' });
        const q2 = data.query;
        this.csrf_token = q2?.tokens?.csrftoken ?? null;
        if (!this.csrf_token) {
            throw new Error('WikiWire: could not get CSRF token from MediaWiki');
        }
    }
    async page_exists(title) {
        const data = await this._post({ action: 'query', titles: title });
        const query = data.query;
        const pages = query?.pages;
        if (!pages)
            return false;
        const page = Object.values(pages)[0];
        return Boolean(page && !page.missing);
    }
    async edit(title, text, summary, content_model) {
        if (!this.csrf_token) {
            throw new Error('WikiWire: not logged in (missing CSRF token)');
        }
        const exists = await this.page_exists(title);
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
        }
        const data = await this._post(params);
        if (data.error) {
            const err = data.error;
            throw new Error(`WikiWire: edit ${title}: ${err.code ?? '?'} ${err.info ?? ''}`);
        }
        const edit = data.edit;
        if (!edit || edit.result !== 'Success') {
            throw new Error(`WikiWire: edit ${title}: unexpected response ${JSON.stringify(data)}`);
        }
    }
}
exports.MediaWikiSession = MediaWikiSession;
