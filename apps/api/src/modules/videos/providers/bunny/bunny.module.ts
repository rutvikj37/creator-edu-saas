import { Module } from '@nestjs/common';
import { VIDEO_PROVIDER } from '../video-provider.interface.js';
import { BunnyStreamProvider } from './bunny.service.js';

/** Binds the provider-neutral VIDEO_PROVIDER token to Bunny Stream. Swap this module to change provider. */
@Module({
  providers: [BunnyStreamProvider, { provide: VIDEO_PROVIDER, useExisting: BunnyStreamProvider }],
  exports: [BunnyStreamProvider, VIDEO_PROVIDER],
})
export class BunnyModule {}
