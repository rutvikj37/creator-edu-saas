import { Global, Module } from '@nestjs/common';
import { FilesController, LocalStorageController } from './files.controller.js';
import { FilesService } from './files.service.js';
import { PdfWatermarkService, WatermarkedFileController } from './pdf-watermark.service.js';

@Global()
@Module({ controllers: [FilesController, LocalStorageController, WatermarkedFileController], providers: [FilesService, PdfWatermarkService], exports: [FilesService, PdfWatermarkService] })
export class FilesModule {}
