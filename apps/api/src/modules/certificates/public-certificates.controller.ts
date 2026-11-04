import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { ClientMetaParam } from '../../common/decorators/auth.decorators.js';
import type { ClientMeta } from '../auth/services/session.service.js';
import { CertificatesService } from './certificates.service.js';

@ApiTags('Certificates (public)')
@Public()
@Controller({ path: 'public/certificates', version: '1' })
export class PublicCertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get(':number')
  @ApiOperation({ summary: 'Verify a certificate by its number (works on any host)' })
  verify(@Param('number') number: string, @ClientMetaParam() meta: ClientMeta) {
    return this.certificates.verify(number.toUpperCase().slice(0, 32), meta);
  }
}
