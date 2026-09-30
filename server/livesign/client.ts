import axios, { AxiosError, AxiosInstance, AxiosResponse } from 'axios';
import { randomUUID } from 'crypto';
import { liveSignConfig } from './config.js';

/** A LiveSign failure with a readable message (API key never included). */
export class LiveSignError extends Error {
  status: number;
  /** true when the request certainly did not create anything, so it is safe to try again later. */
  retryable: boolean;
  constructor(message: string, status = 502, retryable = false) {
    super(message);
    this.name = 'LiveSignError';
    this.status = status;
    this.retryable = retryable;
  }
}

/** LiveSign returns errors as strings, string arrays or ASP.NET ProblemDetails — flatten them. */
function messagesFrom(data: unknown): string[] {
  if (data === undefined || data === null || data === '') return [];
  if (typeof data === 'string') {
    const t = data.trim();
    if (t.startsWith('[') || t.startsWith('{')) {
      try { return messagesFrom(JSON.parse(t)); } catch { /* plain text */ }
    }
    return [t.slice(0, 300)];
  }
  if (Array.isArray(data)) return data.flatMap(messagesFrom);
  if (typeof data === 'object') {
    const o = data as Record<string, any>;
    if (o.errors && typeof o.errors === 'object') {
      return Object.entries(o.errors).flatMap(([field, msgs]) =>
        (Array.isArray(msgs) ? msgs : [msgs]).map(m => (field && field !== '$' ? `${field}: ${m}` : String(m))));
    }
    for (const k of ['message', 'Message', 'detail', 'title', 'error']) {
      if (typeof o[k] === 'string' && o[k]) return [o[k]];
    }
  }
  return [String(data).slice(0, 300)];
}

function toLiveSignError(error: any): LiveSignError {
  if (error instanceof LiveSignError) return error;
  const status: number | undefined = error?.response?.status;
  if (!status) {
    const neverSent = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(String(error?.code));
    return new LiveSignError(`Could not reach LiveSign (${error?.code || error?.message || 'network error'}).`, 504, neverSent);
  }
  const details = messagesFrom(error.response.data).join('; ');
  const base = status === 401 || status === 403
    ? 'LiveSign rejected the API key (check LIVESIGN_API_KEY and that LIVESIGN_BASE_URL matches it: production vs sandbox).'
    : status === 429 ? 'LiveSign rate limit reached.'
    : status >= 500 ? `LiveSign server error (${status}).`
    : `LiveSign rejected the request (${status}).`;
  return new LiveSignError(details ? `${base} ${details}` : base, status, status === 429 || status === 503);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

class LiveSignClient {
  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({ baseURL: liveSignConfig.baseUrl, timeout: 35_000, headers: { Accept: 'application/json' } });
    this.http.interceptors.request.use(req => {
      req.headers['X-API-KEY'] = liveSignConfig.apiKey;
      req.headers['X-Request-Id'] = randomUUID();
      return req;
    });
  }

  /**
   * Reads are retried on network errors / 5xx / 429. Writes are retried only when LiveSign
   * certainly did not process them (429, or the connection was refused) so an envelope is
   * never created twice.
   */
  private async send<T>(method: 'get' | 'post', url: string, data?: unknown): Promise<T> {
    if (!liveSignConfig.enabled) throw new LiveSignError('LIVESIGN_API_KEY is not set.', 503, true);
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res: AxiosResponse<T> = method === 'get' ? await this.http.get<T>(url) : await this.http.post<T>(url, data);
        return res.data;
      } catch (err) {
        lastError = err;
        const e = err as AxiosError;
        const status = e.response?.status;
        const retry = method === 'get'
          ? !status || status >= 500 || status === 429
          : status === 429 || ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(String(e.code));
        if (!retry || attempt === 2) break;
        await sleep(attempt === 0 ? 1000 : 3000);
      }
    }
    throw toLiveSignError(lastError);
  }

  get<T = any>(url: string) { return this.send<T>('get', url); }
  post<T = any>(url: string, data?: unknown) { return this.send<T>('post', url, data); }
}

export const liveSignClient = new LiveSignClient();
