import { Injectable } from '@nestjs/common';
import { resolveTxt } from 'node:dns/promises';

export const VERIFY_PREFIX = '_ce-verify';

/** Checks domain ownership via a TXT record: _ce-verify.<hostname> = ce-verify=<token>. */
@Injectable()
export class DnsVerifier {
  async hasToken(hostname: string, token: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const records = await resolveTxt(`${VERIFY_PREFIX}.${hostname}`);
      const values = records.map((chunks) => chunks.join(''));
      return values.includes(`ce-verify=${token}`) ? { ok: true } : { ok: false, error: 'TXT record found but the value does not match' };
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      return { ok: false, error: code === 'ENOTFOUND' || code === 'ENODATA' ? 'TXT record not found yet' : `DNS lookup failed (${code ?? 'unknown'})` };
    }
  }
}
