import { Timestamp } from 'firebase-admin/firestore';

export interface ChatMessage {
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastUpdated: Timestamp;

  /** Quem enviou */
  from: string;

  /** Tipo de jogo/caso */
  gameType: string;

  /** Flags de moderação */
  hasDirtyWord: boolean;
  hasGiveup: boolean;

  /** Conteúdo da mensagem */
  msgBody: string;
  msgType: string;

  /** Estado do fluxo */
  phaseId: string;
  phaseName: string;

  /** Nome exibido no WhatsApp */
  pushName: string;

  /** Timestamp do WhatsApp */
  timestamp: Timestamp;

  /** Métricas */
  messageCount: number;
}
