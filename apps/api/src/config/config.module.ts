import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './env.schema.js';
import { AppConfig } from './app-config.service.js';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Root .env (monorepo) first, then app-local overrides.
      envFilePath: ['../../.env', '.env'],
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      validate: validateEnv,
    }),
  ],
  providers: [AppConfig],
  exports: [AppConfig],
})
export class AppConfigModule {}
