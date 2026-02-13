export class GenerateCodesDto {
  /** ID do produto (obrigatório). */
  productId: string;
  /** Quantidade de códigos a gerar (1–1000). */
  quantity: number;
  /** ID do lote (opcional; se não enviado, um é gerado). */
  batchId?: string;
}
