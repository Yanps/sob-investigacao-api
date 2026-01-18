import { Timestamp } from 'firebase-admin/firestore';
import { ChatMessage } from './chat-massage.type';

export interface Chat {
  /** Data de criação do chat */
  createdAt: Timestamp;

  /** Última mensagem agregada */
  lastMessage: ChatMessage;

  /**
   * IMPORTANTE (mesmo que hoje não exista em todos):
   * ligação lógica com o cliente
   */
  customerId?: string;

  /**
   * Telefone usado no momento do chat
   * (não é identidade, apenas atributo)
   */
  phoneNumber?: string;
}
