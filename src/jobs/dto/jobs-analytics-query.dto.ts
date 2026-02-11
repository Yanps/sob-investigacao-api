export class JobsAnalyticsQueryDto {
  period?: '24h' | '7d' | '30d';
  /** Filtra métricas por jogo (gameId). Opcional. */
  gameId?: string;
}
