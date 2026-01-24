import { Timestamp } from 'firebase-admin/firestore';

/**
 * Mensagem no formato de array (estrutura alternativa)
 * Usado quando o chat tem um array de mensagens
 */
export interface MessageInArray {
  from: 'client' | 'bot' | 'user';
  msgBody: string;
  msgType: string;
  pushName: string;
  timestamp: string | Timestamp;
  gameType?: string;
  phaseId?: string;
  phaseName?: string;
  hasDirtyWord?: boolean;
  hasGiveup?: boolean;
}

/**
 * Chat pode ter duas estruturas diferentes:
 * 1. Estrutura com lastMessage (objeto único)
 * 2. Estrutura com messages (array de mensagens)
 */
export interface Chat {
  // Campos comuns (podem estar presentes em ambos os formatos)
  createdAt?: Timestamp;
  lastUpdated?: string | Timestamp;
  messageCount?: number;

  // Estrutura 1: lastMessage (objeto único)
  lastMessage?: ChatMessage;

  // Estrutura 2: messages (array de mensagens)
  messages?: MessageInArray[];
}

export interface ChatMessage {
  msgType: string;
  msgBody: string;
  from: 'user' | 'bot' | 'client';
  gameType?: string;
  phaseId?: string;
  phaseName?: string;
  hasDirtyWord?: boolean;
  hasGiveup?: boolean;
  pushName?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  lastUpdated?: Timestamp;
  timestamp?: string | Timestamp;
}
