export class CodesQueryDto {
  /** Filtrar por lote. */
  batchId?: string;
  /** Filtrar por uso: true = já usados, false = disponíveis. */
  used?: boolean;
  /** Limite por página (default 20, max 100). */
  limit?: number;
  /** Cursor para paginação (document ID). */
  startAfter?: string;
}
