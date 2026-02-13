import { Controller, Get, Param, Query, Post, Body } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobsStatsQueryDto } from './dto/jobs-stats-query.dto';
import { JobsAnalyticsQueryDto } from './dto/jobs-analytics-query.dto';
import { PhaseAnalysisDto } from './dto/phase-analysis.dto';
import { Public } from '../common/decorators/public.decorator';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get('phase-analyses')
  async listPhaseAnalyses(@Query('gameId') gameId: string) {
    if (!gameId?.trim()) {
      return { analyses: [] };
    }
    const analyses = await this.jobsService.getPhaseAnalyses(gameId.trim());
    return { analyses };
  }

  @Get('phase-analyses/:gameId/:phaseId')
  async getPhaseAnalysis(
    @Param('gameId') gameId: string,
    @Param('phaseId') phaseId: string,
  ) {
    const analysis = await this.jobsService.getPhaseAnalysis(gameId, phaseId);
    if (!analysis) {
      return { analysis: null, message: 'Phase analysis not found' };
    }
    return { analysis };
  }

  @Post('phase-analyses')
  async savePhaseAnalysis(@Body() dto: PhaseAnalysisDto) {
    if (!dto.gameId?.trim() || !dto.phaseId?.trim()) {
      return { success: false, message: 'gameId and phaseId are required' };
    }
    const result = await this.jobsService.savePhaseAnalysis(dto.gameId.trim(), dto.phaseId.trim(), {
      phaseName: dto.phaseName,
      analysisText: dto.analysisText,
      topWords: dto.topWords,
    });
    return { success: true, ...result };
  }

  @Get()
  list(
    @Query('status') status?: 'pending' | 'processing' | 'done' | 'failed',
    @Query('phoneNumber') phoneNumber?: string,
    @Query('limit') limit?: string,
    @Query('startAfter') startAfter?: string,
  ) {
    const limitNum = limit ? Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100) : 20;
    return this.jobsService.list({
      status,
      phoneNumber,
      limit: limitNum,
      startAfter,
    });
  }

  @Get('stats')
  getStats(@Query() query: JobsStatsQueryDto) {
    return this.jobsService.getStats(query.period);
  }

  @Get('analytics')
  getDashboardAnalytics(@Query() query: JobsAnalyticsQueryDto) {
    return this.jobsService.getDashboardAnalytics({
      period: query.period,
      gameId: query.gameId,
    });
  }

  @Public()
  @Get('debug/chat-fields')
  async debugChatFields(@Query('limit') limitParam?: string) {
    return this.jobsService.debugChatFields(parseInt(limitParam ?? '5', 10));
  }

  @Get(':jobId')
  async getOne(@Param('jobId') jobId: string) {
    const job = await this.jobsService.getById(jobId);
    if (!job) {
      return { job: null, message: 'Job not found' };
    }
    return { job };
  }
}
