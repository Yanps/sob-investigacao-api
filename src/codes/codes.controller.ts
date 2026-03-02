import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  NotFoundException,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { CodesService } from './codes.service';
import { PdfGenerationService } from './pdf-generation.service';
import { GenerateCodesDto } from './dto/generate-codes.dto';

@Controller('codes')
export class CodesController {
  constructor(
    private readonly codesService: CodesService,
    private readonly pdfGenerationService: PdfGenerationService,
  ) {}

  @Post('generate')
  async generate(@Body() dto: GenerateCodesDto) {
    return this.codesService.generate({
      productId: dto.productId,
      quantity: dto.quantity ?? 1,
      batchId: dto.batchId,
    });
  }

  @Get()
  async list(
    @Query('batchId') batchId?: string,
    @Query('used') used?: string,
    @Query('limit') limit?: string,
    @Query('startAfter') startAfter?: string,
  ) {
    const usedBool =
      used === undefined ? undefined : used === 'true';
    const limitNum = limit
      ? Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100)
      : 20;
    return this.codesService.list({
      batchId,
      used: usedBool,
      limit: limitNum,
      startAfter,
    });
  }

  @Get('batches')
  async listBatches() {
    return this.codesService.listBatches();
  }

  @Get('download')
  async downloadBatch(
    @Query('batchId') batchId: string,
    @Res() res: Response,
  ) {
    if (!batchId?.trim()) {
      throw new BadRequestException('batchId é obrigatório');
    }

    // Fetch all codes for the batch
    const codes = await this.codesService.listAllForBatch(batchId);

    if (!codes.length) {
      throw new NotFoundException(`Nenhum código encontrado para o lote: ${batchId}`);
    }

    // Generate ZIP with PDFs
    const zipBuffer = await this.pdfGenerationService.generateBatchZip(codes);

    // Return ZIP file
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="codigos_${batchId}.zip"`,
      'Content-Length': zipBuffer.length,
    });
    res.send(zipBuffer);
  }

  @Get(':code')
  async getByCode(@Param('code') code: string) {
    const result = await this.codesService.getByCode(code);
    if (!result) {
      throw new NotFoundException(`Código não encontrado: ${code}`);
    }
    return { code: result };
  }
}
