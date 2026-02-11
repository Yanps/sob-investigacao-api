export class PhaseAnalysisDto {
  gameId: string;
  phaseId: string;
  phaseName?: string;
  /** Texto da análise gerada por IA */
  analysisText?: string;
  /** Palavras mais usadas (pode ser sobrescrito ao gerar nova análise) */
  topWords?: Array<{ word: string; count: number }>;
}
