import { Timestamp } from 'firebase-admin/firestore';

export interface Customer {
  cpf: string;
  name: string;
  phoneNumber: string;
  phoneNumberAlt?: string;
  aiMessages: number;
  twoFactorAuth: 'empty' | 'pending' | 'validated';
  twoFactorTimestamp?: Timestamp;
  createdAt: Timestamp;
}
