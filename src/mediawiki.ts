// designed for MW 1.45

const WIKIWIRE_UA = 'WikiWire/1.0'; // do not change unless the featureset drastically changes (UA may be whitelisted)

// exp backoff consts

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAXLAG_SECONDS = 5;
const NEEDTOKEN_MAX = 2;
const POST_RATE_LIMIT_GAP_MS = 1000;

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

export type mw_session_opts = {
    log ?: (message : string) => void;
    site_id ?: string;
};

type wait_decision =
    | { kind : 'wait'; ms : number; truncated : boolean }
    | { kind : 'stop'; reason : string };

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

function parse_retry_after(header : string | null, now_ms : number = Date.now()) : number | null {
    if (!header) return null;

    const trimmed = header.trim();
    if (!trimmed) return null;

    if (/^\d+$/.test(trimmed)) { return Math.max(0, Number(trimmed) * 1000) };

    const date_ms = Date.parse(trimmed);
    if (Number.isNaN(date_ms)) return null;

    return Math.max(0, date_ms - now_ms);
};

function next_backoff_ms(attempt : number) : number {
    const exp = BASE_DELAY_MS * (2 ** (attempt - 1));
    const capped = Math.min(MAX_DELAY_MS, exp);
    const jitter = 0.8 + Math.random() * 0.2;

    return Math.round(capped * jitter);
};

function is_retryable_http_status(status : number) : boolean {
    return status === 429 || status === 502 || status === 503 || status === 504;
};

function is_retryable_api_code(code : string) : boolean {
    return code === 'ratelimited' || code === 'maxlag' || code === 'readonly';
};

function is_session_drop_code(code : string) : boolean {
    return code === 'badtoken' || code === 'notoken' || code === 'assertuserfailed';
};

function is_retryable_network_error(err : unknown) : boolean {
    if (!(err instanceof Error)) return false;
    if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
    if (err.name === 'TypeError') return true;

    return false;
};

function sleep(ms : number) : Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
};

function wait_ms_for_log(ms : number) : string {
    if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;

    const seconds = ms / 1000;

    if (Number.isInteger(seconds)) return `${seconds}s`;

    return `${seconds.toFixed(1)}s`;
};

function decide_wait(opts : {
    attempt : number;
    retry_after_ms : number | null;
    already_truncated : boolean;
}) : wait_decision {
    if (opts.attempt >= MAX_ATTEMPTS) {
        return { kind: 'stop', reason: 'attempts exhausted' };
    };

    if (opts.retry_after_ms != null && opts.retry_after_ms > MAX_DELAY_MS) {
        if (opts.already_truncated) {
            return { kind: 'stop', reason: 'wiki asked to wait longer than the 60s cap' };
        };

        return { kind: 'wait', ms: MAX_DELAY_MS, truncated: true };
    };

    const ms = opts.retry_after_ms != null
        ? Math.min(MAX_DELAY_MS, opts.retry_after_ms)
        : next_backoff_ms(opts.attempt);

    return { kind: 'wait', ms, truncated: false };
};

function retry_context_note(retried : number, total_wait_ms : number) : string {
    if (retried <= 0) return '';

    return ` retried ${retried} times, waited ${wait_ms_for_log(total_wait_ms)} total.`;
};

export class mw_session {
    api_url : string;
    username : string;
    password : string;
    cookies : Map<string, string>;
    csrftoken : string | null;
    log ?: (message : string) => void;
    site_id ?: string;
    _min_gap_ms : number;
    _last_request_at : number | null;

    constructor(api_url : string, username : string, password : string, opts : mw_session_opts = {}) {
        this.api_url = api_url;
        this.username = username;
        this.password = password;
        this.cookies = new Map();
        this.csrftoken = null;
        this.log = opts.log;
        this.site_id = opts.site_id;
        this._min_gap_ms = 0;
        this._last_request_at = null;
    };

    _site_label() : string {
        if (this.site_id) return ` on ${this.site_id}`;

        return ` at ${api_url_for_log(this.api_url)}`;
    };

    _log(message : string) : void {
        this.log?.(message);
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

    _arm_cooldown() : void {
        if (this._min_gap_ms > 0) return;

        this._min_gap_ms = POST_RATE_LIMIT_GAP_MS;
        this._log('WikiWire: will space later requests by 1s on this session after a rate limit');
    };

    async _respect_min_gap() : Promise<void> {
        if (this._min_gap_ms <= 0 || this._last_request_at == null) return;

        const due = this._last_request_at + this._min_gap_ms - Date.now();
        if (due <= 0) return;

        await sleep(due);
    };

    _http_error_message(res : Response, action : string, detail : string, retried : number, total_wait_ms : number) : string {
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
            ' (please refer to the WikiWire documentation on 403 error codes https://github.com/obbywiki/wikiwire)';
        };

        return `WikiWire HTTP error: ${scope.join('; ')}. ${body_note}${hint}${retry_context_note(retried, total_wait_ms)}`;
    };

    async _wait_retry(opts : {
        decision : { kind : 'wait'; ms : number; truncated : boolean };
        attempt : number;
        action : string;
        title ?: string;
        cause : string;
        retry_after_ms : number | null;
        cool_down ?: boolean;
    }) : Promise<void> {
        if (opts.cool_down) { this._arm_cooldown() };

        const title_note = opts.title ? ` for ${opts.title}` : '';
        const next_attempt = opts.attempt + 1;

        if (opts.decision.truncated && opts.retry_after_ms != null) {
            this._log(
                `WikiWire: wiki asked to wait ${wait_ms_for_log(opts.retry_after_ms)}; waiting 60s cap (retry ${next_attempt}/${MAX_ATTEMPTS})`,
            );
        } else if (opts.retry_after_ms != null) {
            this._log(
                `WikiWire: ${opts.cause} on action=${opts.action}${title_note}; wiki Retry-After=${wait_ms_for_log(opts.retry_after_ms)}; waiting ${wait_ms_for_log(opts.decision.ms)} (retry ${next_attempt}/${MAX_ATTEMPTS})`,
            );
        } else {
            this._log(
                `WikiWire: ${opts.cause} on action=${opts.action}${title_note}; waiting ${wait_ms_for_log(opts.decision.ms)} (retry ${next_attempt}/${MAX_ATTEMPTS})`,
            );
        };

        await sleep(opts.decision.ms);
    };

    async _fetch_once(params : Record<string, string>) : Promise<Response> {
        const body = new URLSearchParams({
            format: 'json',
            ...params,
            maxlag: String(MAXLAG_SECONDS),
        });

        return fetch(this.api_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': WIKIWIRE_UA,
                ...this._cookie_header(),
            },
            body,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    };

    // general POST helper/wrapper with polite retries
    async _post(params : Record<string, string>) : Promise<mw_api_res> {
        const action = typeof params.action === 'string' ? params.action : '?';
        const title = typeof params.title === 'string' ? params.title : undefined;
        let retried = 0;
        let total_wait_ms = 0;
        let truncated_long_retry_after = false;
        let last_retryable = '';

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            await this._respect_min_gap();

            let res : Response;

            try {
                res = await this._fetch_once(params);
            } catch (err : unknown) {
                if (!is_retryable_network_error(err)) { throw err };

                const cause = err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
                    ? 'request timed out'
                    : 'network error';
                last_retryable = cause;

                const decision = decide_wait({
                    attempt,
                    retry_after_ms: null,
                    already_truncated: truncated_long_retry_after,
                });

                if (decision.kind === 'stop') {
                    const detail = err instanceof Error ? err.message : String(err);

                    throw new Error(
                        `WikiWire HTTP error: ${cause} on action=${action}; api=${api_url_for_log(this.api_url)}. ${detail}${retry_context_note(retried, total_wait_ms)}`,
                    );
                };

                retried += 1;
                total_wait_ms += decision.ms;
                await this._wait_retry({ decision, attempt, action, title, cause, retry_after_ms: null });
                continue;
            };

            this._merge_set_cookie(res.headers);
            this._last_request_at = Date.now();

            if (is_retryable_http_status(res.status)) {
                const detail = await res.text();
                const retry_after_ms = parse_retry_after(res.headers.get('retry-after'));
                const cause = `HTTP ${res.status}`;
                last_retryable = cause;

                const decision = decide_wait({
                    attempt,
                    retry_after_ms,
                    already_truncated: truncated_long_retry_after,
                });

                if (decision.kind === 'stop') {
                    throw new Error(
                        this._http_error_message(res, action, detail, retried, total_wait_ms) + ` (${decision.reason})`,
                    );
                };

                if (decision.truncated) { truncated_long_retry_after = true };

                retried += 1;
                total_wait_ms += decision.ms;
                await this._wait_retry({
                    decision,
                    attempt,
                    action,
                    title,
                    cause,
                    retry_after_ms,
                    cool_down: res.status === 429,
                });
                continue;
            };

            if (!res.ok) {
                const detail = await res.text();

                throw new Error(this._http_error_message(res, action, detail, retried, total_wait_ms));
            };

            let data : mw_api_res;

            try {
                data = (await res.json()) as mw_api_res;
            } catch {
                throw new Error(
                    `WikiWire HTTP error: action=${action}; api=${api_url_for_log(this.api_url)}; response was not JSON${retry_context_note(retried, total_wait_ms)}`,
                );
            };

            const code = data.error?.code ?? '';

            if (code && is_retryable_api_code(code)) {
                const retry_after_ms = parse_retry_after(res.headers.get('retry-after'));
                const cause = `API ${code}`;
                last_retryable = cause;

                const decision = decide_wait({
                    attempt,
                    retry_after_ms,
                    already_truncated: truncated_long_retry_after,
                });

                if (decision.kind === 'stop') {
                    const info = data.error?.info ?? '';

                    throw new Error(
                        `WikiWire API error: ${action}${title ? ` ${title}` : ''}: ${code} ${info}`.trim() +
                        ` (${last_retryable}; ${decision.reason})${retry_context_note(retried, total_wait_ms)}`,
                    );
                };

                if (decision.truncated) { truncated_long_retry_after = true };

                retried += 1;
                total_wait_ms += decision.ms;
                await this._wait_retry({
                    decision,
                    attempt,
                    action,
                    title,
                    cause,
                    retry_after_ms,
                    cool_down: code === 'ratelimited' || code === 'maxlag',
                });
                continue;
            };

            return data;
        };

        throw new Error(
            `WikiWire HTTP error: ${last_retryable || 'request failed'} on action=${action}; api=${api_url_for_log(this.api_url)}${retry_context_note(retried, total_wait_ms)}`,
        );
    };

    async _authed_post(params : Record<string, string>, relogin_attempted : boolean = false) : Promise<mw_api_res> {
        const data = await this._post(params);
        const code = data.error?.code ?? '';

        if (!is_session_drop_code(code)) { return data };

        if (relogin_attempted) {
            throw new Error(`WikiWire API error: session dropped (${code}) after re-login; stopping`);
        };

        this._log(`WikiWire: session dropped (${code})${this._site_label()}; re-authenticating once`);
        await this.login();

        const retry_params = { ...params };

        if (retry_params.token !== undefined) {
            if (!this.csrftoken) { throw new Error('WikiWire API error: not logged in (missing CSRF token)'); };

            retry_params.token = this.csrftoken;
        };

        return this._authed_post(retry_params, true);
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
        let needtoken_attempts = 0;

        while (login?.result === 'NeedToken' && login.token) {
            needtoken_attempts += 1;

            if (needtoken_attempts > NEEDTOKEN_MAX) {
                throw new Error(`WikiWire API error: MediaWiki login failed: NeedToken repeated ${NEEDTOKEN_MAX} times`);
            };

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
        const data = await this._authed_post({ action: 'query', titles: title });
        const query = data.query;
        const pages = query?.pages;

        if (!pages) return false;

        const page = Object.values(pages)[0];

        return Boolean(page && !page.missing);
    };

    async _edit_once(params : Record<string, string>) : Promise<mw_api_res> {
        const data = await this._authed_post(params);

        if (data.error) { return data };

        const edit = data.edit;

        if (!edit || edit.result != 'Success') { throw new Error(`WikiWire API error: edit ${params.title}: unexpected response ${JSON.stringify(data)}`); };

        return data;
    };

    _edit_params(title : string, text : string, summary : string, extra : Record<string, string> = {}) : Record<string, string> {
        if (!this.csrftoken) { throw new Error('WikiWire API error: not logged in (missing CSRF token)'); };

        return {
            action: 'edit',
            title,
            text,
            summary,
            token: this.csrftoken,
            bot: '1',
            ...extra,
        };
    };

    async edit(
        title : string,
        text : string,
        summary : string,
        content_model : string,
        existence : existence_hint = 'probe',
    ) : Promise<edit_result> {
        if (!this.csrftoken) { throw new Error('WikiWire API error: not logged in (missing CSRF token)'); };

        if (existence === 'probe') {
            const exists = await this.page_exists(title);
            const extra : Record<string, string> = {};

            if (!exists) { extra.contentmodel = content_model };

            const data = await this._edit_once(this._edit_params(title, text, summary, extra));

            if (data.error) {
                const err = data.error;
                throw new Error(`WikiWire API error: edit ${title}: ${err.code ?? '?'} ${err.info ?? ''}`);
            };

            return { fallback: false };
        };

        if (existence === 'assume_exists') {
            const first = await this._edit_once(this._edit_params(title, text, summary, { nocreate: '1' }));

            if (!first.error) { return { fallback: false } };

            const code = first.error.code ?? '';

            if (!is_missing_page_edit_error(code)) {
                throw new Error(`WikiWire API error: edit ${title}: ${code || '?'} ${first.error.info ?? ''}`);
            };

            const retry = await this._edit_once(this._edit_params(title, text, summary, { contentmodel: content_model }));

            if (retry.error) {
                const err = retry.error;
                throw new Error(`WikiWire API error: edit ${title}: ${err.code ?? '?'} ${err.info ?? ''}`);
            };

            return { fallback: true };
        };

        // assume_create
        const first = await this._edit_once(this._edit_params(title, text, summary, { contentmodel: content_model, createonly: '1' }));

        if (!first.error) { return { fallback: false } };

        const code = first.error.code ?? '';

        if (!is_createonly_conflict_error(code)) {
            throw new Error(`WikiWire API error: edit ${title}: ${code || '?'} ${first.error.info ?? ''}`);
        };

        const retry = await this._edit_once(this._edit_params(title, text, summary));

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

        if (!this.csrftoken) { throw new Error('WikiWire API error: not logged in (missing CSRF token)'); };

        const data = await this._authed_post({
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
