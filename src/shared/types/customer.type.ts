import { Timestamp } from 'firebase-admin/firestore';

export interface Customer {
  /** Quantidade de mensagens de IA já consumidas */
  aiMessages: number;

  /** CPF usado como identificador lógico */
  cpf: string;

  /** Data de criação do cliente */
  createdAt: Timestamp;

  /** Nome completo */
  name: string;

  /** Telefone principal (WhatsApp atual) */
  phoneNumber: string;

  /** Telefone anterior (histórico / fallback) */
  phoneNumberAlt?: string;

  /** Status do 2FA */
  twoFactorAuth: string;

  /** Timestamp do último evento de 2FA */
  twoFactorTimestamp?: Timestamp;
}
