import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { CodesService } from './codes.service';
import { GenerateCodesDto } from './dto/generate-codes.dto';

@Controller('codes')
export class CodesController {
  constructor(private readonly codesService: CodesService) {}

  @Post('generate')
  async generate(@Body() dto: GenerateCodesDto) {
    return this.codesService.generate({
      gameId: dto.gameId,
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

  @Get(':code')
  async getByCode(@Param('code') code: string) {
    const result = await this.codesService.getByCode(code);
    if (!result) {
      throw new NotFoundException(`Código não encontrado: ${code}`);
    }
    return { code: result };
  }
}
