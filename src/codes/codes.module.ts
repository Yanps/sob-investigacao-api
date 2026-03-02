import { Module } from '@nestjs/common';
import { CodesController } from './codes.controller';
import { CodesService } from './codes.service';
import { PdfGenerationService } from './pdf-generation.service';

@Module({
  controllers: [CodesController],
  providers: [CodesService, PdfGenerationService],
  exports: [CodesService],
})
export class CodesModule {}
