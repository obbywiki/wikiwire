// designed for MW 1.45

const WIKIWIRE_UA = 'WikiWire/1.0'; // do not change unless the featureset drastically changes (UA may be whitelisted)

type mw_query = {
    tokens ?: { logintoken ?: string; csrftoken ?: string };
    pages ?: Record<string, { missing ?: boolean }>;
};

type mw_login = { result ?: string; token ?: string };
type mw_edit = { result ?: string };
type mw_error = { code ?: string; info ?: string };

type mw_api_res = {
    query ?: mw_query;
    login ?: mw_login;
    edit ?: mw_edit;
    error ?: mw_error;
};


function api_url_for_log(api_url : string) : string {
    try {
        const url = new URL(api_url);

        return `${url.origin}${url.pathname}`;
    } catch {
        return '(invalid api URL)';
    };
};

function summarize_error_body(text : string, max_len : number) : string {
    const one_line = text.trim().replace(/\s+/g, ' ');
    const is_html = text.startsWith('<!DOCTYPE html>') || text.startsWith('<html');
    const prefix = is_html ? 'unexpected HTML body from retrieved from the Action API: ' : 'body: ';

    if (one_line.length <= max_len) return prefix + one_line;
    return prefix + `${one_line.slice(0, max_len)}...`;
};

function get_set_cookie_lines(headers : Headers) : string[] {
    const h = headers as Headers & { getSetCookie ?: () => string[] };

    if (typeof h.getSetCookie === 'function') { return h.getSetCookie(); };

    const sc = headers.get('set-cookie');

    return sc ? [sc] : [];
};

export class mw_session {
    api_url : string;
    username : string;
    password : string;
    cookies : Map<string, string>;
    csrftoken : string | null;

    constructor(api_url : string, username : string, password : string) {
        this.api_url = api_url;
        this.username = username;
        this.password = password;
        this.cookies = new Map();
        this.csrftoken = null;
    };

    _merge_set_cookie(headers: Headers): void {
        const list = get_set_cookie_lines(headers);

        for (const line of list) {
            const nv = line.split(';')[0].trim();
            const eq = nv.indexOf('=');

            if (eq === -1) continue;

            const name = nv.slice(0, eq).trim();
            const value = nv.slice(eq + 1).trim();

            this.cookies.set(name, value);
        };
    };

    _cookie_header() : Record<string, string> {
        if (this.cookies.size === 0) return {};

        return {
            Cookie: [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
        };
    };

    // general POST helper/wrapper
    async _post(params : Record<string, string>) : Promise<mw_api_res> {
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
            const scope = [
                `HTTP ${res.status} ${res.statusText}`,
                `action=${action}`,
                `api=${api_url_for_log(this.api_url)}`,
            ];

            const cf_ray = res.headers.get('cf-ray');
            const www_auth = res.headers.get('www-authenticate');
            const server = res.headers.get('server');
            
            if (cf_ray) { scope.push(`cf-ray=${cf_ray}`) };
            if (www_auth) { scope.push(`www-authenticate=${www_auth}`) };
            if (server) { scope.push(`server=${server}`) };

            const body_note = summarize_error_body(detail, 400);
            let hint = '';

            if (res.status === 403) {
                hint =
                ' (please refer to the WikWire documentation on 403 error codes https://github.com/obbywiki/wikiwire)';
                // ' (403 usually means the HTTP layer blocked the request—wrong URL, bot/WAF rules, IP allowlist, or missing Host/HTTPS—not a MediaWiki API error code. If your wiki is behind a service like Cloudflare and its Bot Fight Mode, you may need to disable it or programmatically enable access overwrites with something like xiaotianxt/bypass-cloudflare-for-github-action)';
            };

            throw new Error(`WikiWire debug: ${scope.join('; ')}. ${body_note}${hint}`);
        };

        return (await res.json()) as mw_api_res;
    };

    // gets login tokens for future actions (could be optimised)
    async login() : Promise<void> {
        let data = await this._post({ action: 'query', meta: 'tokens', type: 'login' });

        const query = data.query;
        let login_token = query?.tokens?.logintoken;

        if (!login_token) { throw new Error('WikiWire API error: could not get login token from MediaWiki'); };

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
        };

        if (login?.result !== 'Success') { throw new Error(`WikiWire API error: MediaWiki login failed: ${JSON.stringify(login)}`); };

        data = await this._post({ action: 'query', meta: 'tokens', type: 'csrf' });

        const q2 = data.query;

        this.csrftoken = q2?.tokens?.csrftoken ?? null;

        if (!this.csrftoken) { throw new Error('WikiWire API error: could not get CSRF token from MediaWiki'); };

        // no return expected
    };

    // self explanatory
    async page_exists(title : string) : Promise<boolean> {
        const data = await this._post({ action: 'query', titles: title });
        const query = data.query;
        const pages = query?.pages;

        if (!pages) return false;

        const page = Object.values(pages)[0];

        return Boolean(page && !page.missing);
    };

    async edit(title : string, text : string, summary : string, content_model : string) : Promise<void> {
        if (!this.csrftoken) { throw new Error('WikiWire API error: not logged in (missing CSRF token)'); };

        const exists = await this.page_exists(title);
        const params: Record<string, string> = {
            action: 'edit',
            title,
            text,
            summary,
            token: this.csrftoken,
            bot: '1',
        };

        if (!exists) { params.contentmodel = content_model; };

        const data = await this._post(params);

        if (data.error) { const err = data.error; throw new Error(`WikiWire API error: edit ${title}: ${err.code ?? '?'} ${err.info ?? ''}`); };

        const edit = data.edit;

        if (!edit || edit.result != 'Success') { throw new Error(`WikiWire API error: edit ${title}: unexpected response ${JSON.stringify(data)}`); };

        // no return expected
    };
};
