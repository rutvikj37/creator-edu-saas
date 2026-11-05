import { Injectable } from '@nestjs/common';

export interface HttpResponse {
  status: number;
  json: any;
}

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  /** JSON object, or a pre-encoded string (form bodies). */
  body?: unknown;
}

/**
 * Outbound HTTP for payment providers. A single seam so tests can substitute recorded
 * provider responses; production always uses fetch with a timeout.
 */
@Injectable()
export class PaymentHttp {
  timeoutMs = 20_000;

  async request(url: string, req: HttpRequest): Promise<HttpResponse> {
    const headers: Record<string, string> = { Accept: 'application/json', ...(req.headers ?? {}) };
    let body: string | undefined;
    if (typeof req.body === 'string') body = req.body;
    else if (req.body !== undefined) {
      body = JSON.stringify(req.body);
      headers['Content-Type'] ??= 'application/json';
    }
    const res = await fetch(url, { method: req.method, headers, body, signal: AbortSignal.timeout(this.timeoutMs) });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 500) };
    }
    return { status: res.status, json };
  }
}

export function basicAuth(user: string, pass: string) {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

