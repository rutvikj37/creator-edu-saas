import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { HostResolverService } from './host-resolver.service.js';
import type { AppRequest } from './request-context.js';

/**
 * Attaches `req.hostRealm`. `req.hostname` honours X-Forwarded-Host only from trusted
 * proxies (express "trust proxy"), so clients cannot spoof the tenant via headers.
 * Unknown hosts are left unresolved; guards turn that into a 404.
 */
@Injectable()
export class HostResolverMiddleware implements NestMiddleware {
  constructor(private readonly resolver: HostResolverService) {}

  async use(req: AppRequest, _res: Response, next: NextFunction) {
    try {
      req.hostRealm = (await this.resolver.resolve(req.hostname)) ?? undefined;
      next();
    } catch (err) {
      next(err);
    }
  }
}
