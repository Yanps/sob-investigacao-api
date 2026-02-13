import { Timestamp } from 'firebase-admin/firestore';

export interface Game {
  name: string;
  type: string;
  productId?: string;
  prompts?: Record<string, unknown>;
  config?: Record<string, unknown>;
  active: boolean;
  createdAt: Date | Timestamp;
  updatedAt?: Date | Timestamp;
}
