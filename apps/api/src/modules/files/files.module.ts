import { Global, Module } from '@nestjs/common';
import { FilesController, LocalStorageController } from './files.controller.js';
import { FilesService } from './files.service.js';

@Global()
@Module({ controllers: [FilesController, LocalStorageController], providers: [FilesService], exports: [FilesService] })
export class FilesModule {}
