import { Controller, Get, Query } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service';
import { Timestamp } from 'firebase-admin/firestore';

type PeriodOption = '24h' | '7d' | '30d';

function toISOString(value: Date | Timestamp | undefined): string | undefined {
  if (value == null) return undefined;
  const date =
    value instanceof Timestamp ? value.toDate() : value instanceof Date ? value : new Date(value as unknown as string);
  return date.toISOString();
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly jobsService: JobsService) {}

  /**
   * GET /api/dashboard/summary?gameType=mosco&period=7d
   * Retorna o mesmo formato do dashboard (averageTimes, swearWords, giveupWords, phaseMessages, aiAnalysis).
   * Todas as métricas vêm de agent_responses (gameId, phaseId, createdAt, hasOffense, hasDesistencia); aiAnalysis de phase_analyses.
   */
  @Get('summary')
  async getSummary(
    @Query('gameType') gameType?: string,
    @Query('period') period?: string,
  ) {
    const gameId = gameType?.trim() && gameType.toLowerCase() !== 'all' ? gameType.trim() : undefined;
    const periodOption: PeriodOption =
      period === '24h' || period === '7d' || period === '30d' ? period : '7d';

    const [analytics, analyses] = await Promise.all([
      this.jobsService.getDashboardSummary({
        gameId,
        period: periodOption,
      }),
      gameId ? this.jobsService.getPhaseAnalyses(gameId) : Promise.resolve([]),
    ]);

    return this.buildDashboardResponse(gameId ?? null, analytics, analyses);
  }

  /**
   * GET /api/dashboard?gameType=mosco&period=7d
   * Retorna o formato esperado pelo frontend (averageTimes, swearWords, giveupWords, phaseMessages, aiAnalysis).
   */
  @Get()
  async getDashboard(
    @Query('gameType') gameType?: string,
    @Query('period') period?: string,
  ) {
    const gameId = gameType?.trim() || undefined;
    const periodOption: PeriodOption =
      period === '24h' || period === '7d' || period === '30d' ? period : '7d';

    const [analytics, analyses] = await Promise.all([
      this.jobsService.getDashboardAnalytics({
        gameId,
        period: periodOption,
      }),
      gameId ? this.jobsService.getPhaseAnalyses(gameId) : Promise.resolve([]),
    ]);

    return this.buildDashboardResponse(gameId ?? null, analytics, analyses);
  }

  private buildDashboardResponse(
    gameType: string | null,
    analytics: Awaited<ReturnType<JobsService['getDashboardAnalytics']>>,
    analyses: Awaited<ReturnType<JobsService['getPhaseAnalyses']>>,
  ) {
    const porFase = analytics.porFase.filter(
      (p) => (p.phaseId ?? '').toLowerCase() !== 'geral' && (p.phaseName ?? '').toLowerCase() !== 'geral',
    );
    const labels = porFase.map((p) => p.phaseName);

    const averageTimes = {
      labels,
      data: porFase.map((p) => p.tempoMedioMin ?? 0),
      avgTotalTime: analytics.tempoMedioTotalMin,
    };

    const swearWordsData = porFase.map((p) => p.totalInsultos);
    const giveupWordsData = porFase.map((p) => p.totalDesistencia);
    const swearWords = {
      labels,
      data: swearWordsData,
      totalSwearWords: swearWordsData.reduce((a, b) => a + b, 0),
    };

    const giveupWords = {
      labels,
      data: giveupWordsData,
      totalGiveupWords: giveupWordsData.reduce((a, b) => a + b, 0),
    };

    const phaseMessages = {
      labels,
      data: porFase.map((p) => p.totalMensagens),
    };

    const aiAnalysis = analyses.map((a) => ({
      phaseId: a.phaseId,
      phase: a.phaseName ?? a.phaseId,
      analysis: a.analysisText ?? '',
      createdAt: toISOString(a.generatedAt),
      topWords: (a.topWords ?? []).map((w) => ({ word: w.word, count: w.count })),
    }));

    return {
      gameType,
      averageTimes,
      swearWords,
      giveupWords,
      phaseMessages,
      aiAnalysis,
    };
  }
}
