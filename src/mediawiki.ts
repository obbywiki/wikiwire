// designed for MW 1.45

const WIKIWIRE_UA = 'WikiWire/1.0'; // do not change unless the featureset drastically changes (UA may be whitelisted)

type mw_query = {
    tokens ?: { logintoken ?: string; csrftoken ?: string };
    pages ?: Record<string, { missing ?: boolean }>;
};

type mw_login = { result ?: string; token ?: string };
type mw_edit = { result ?: string };
type mw_delete = { title ?: string; reason ?: string; logid ?: number };
type mw_error = { code ?: string; info ?: string };

type mw_api_res = {
    query ?: mw_query;
    login ?: mw_login;
    edit ?: mw_edit;
    delete ?: mw_delete;
    error ?: mw_error;
};

export type existence_hint = 'probe' | 'assume_exists' | 'assume_create';

export type edit_result = {
    fallback : boolean;
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

function is_missing_page_edit_error(code : string) : boolean {
    return code === 'missingtitle' || code === 'nocreate-missing' || code === 'edit-no-create';
};

function is_createonly_conflict_error(code : string) : boolean {
    return (
        code === 'articleexists' ||
        code === 'edit-alreadyexists' ||
        code === 'badcontentmodel' ||
        code === 'invalid-contentmodel' ||
        code === 'changecontentmodel-cannot-convert' ||
        code === 'nochangecontentmodel'
    );
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

    async _edit_once(params : Record<string, string>) : Promise<mw_api_res> {
        const data = await this._post(params);

        if (data.error) { return data };

        const edit = data.edit;

        if (!edit || edit.result != 'Success') { throw new Error(`WikiWire API error: edit ${params.title}: unexpected response ${JSON.stringify(data)}`); };

        return data;
    };

    async edit(
        title : string,
        text : string,
        summary : string,
        content_model : string,
        existence : existence_hint = 'probe',
    ) : Promise<edit_result> {
        if (!this.csrftoken) { throw new Error('WikiWire API error: not logged in (missing CSRF token)'); };

        const base : Record<string, string> = {
            action: 'edit',
            title,
            text,
            summary,
            token: this.csrftoken,
            bot: '1',
        };

        if (existence === 'probe') {
            const exists = await this.page_exists(title);
            const params = { ...base };

            if (!exists) { params.contentmodel = content_model };

            const data = await this._edit_once(params);

            if (data.error) {
                const err = data.error;
                throw new Error(`WikiWire API error: edit ${title}: ${err.code ?? '?'} ${err.info ?? ''}`);
            };

            return { fallback: false };
        };

        if (existence === 'assume_exists') {
            const first = await this._edit_once({ ...base, nocreate: '1' });

            if (!first.error) { return { fallback: false } };

            const code = first.error.code ?? '';

            if (!is_missing_page_edit_error(code)) {
                throw new Error(`WikiWire API error: edit ${title}: ${code || '?'} ${first.error.info ?? ''}`);
            };

            const retry = await this._edit_once({ ...base, contentmodel: content_model });

            if (retry.error) {
                const err = retry.error;
                throw new Error(`WikiWire API error: edit ${title}: ${err.code ?? '?'} ${err.info ?? ''}`);
            };

            return { fallback: true };
        };

        // assume_create
        const first = await this._edit_once({ ...base, contentmodel: content_model, createonly: '1' });

        if (!first.error) { return { fallback: false } };

        const code = first.error.code ?? '';

        if (!is_createonly_conflict_error(code)) {
            throw new Error(`WikiWire API error: edit ${title}: ${code || '?'} ${first.error.info ?? ''}`);
        };

        const retry = await this._edit_once({ ...base });

        if (retry.error) {
            const err = retry.error;
            throw new Error(`WikiWire API error: edit ${title}: ${err.code ?? '?'} ${err.info ?? ''}`);
        };

        return { fallback: true };
    };

    // returns true if deleted, false if page was already missing
    async delete(title : string, reason : string, opts : { probe ?: boolean } = {}) : Promise<boolean> {
        if (!this.csrftoken) { throw new Error('WikiWire API error: not logged in (missing CSRF token)'); };

        const probe = opts.probe !== false;

        if (probe) {
            const exists = await this.page_exists(title);
            if (!exists) { return false };
        };

        const data = await this._post({
            action: 'delete',
            title,
            reason,
            token: this.csrftoken,
            bot: '1',
        });

        if (data.error) {
            const err = data.error;
            const code = err.code ?? '';

            if (code === 'missingtitle' || code === 'pagedeleted') { return false };

            throw new Error(`WikiWire API error: delete ${title}: ${code || '?'} ${err.info ?? ''}`);
        };

        if (!data.delete) { throw new Error(`WikiWire API error: delete ${title}: unexpected response ${JSON.stringify(data)}`); };

        return true;
    };
};
