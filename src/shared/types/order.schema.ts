import { Timestamp } from 'firebase-admin/firestore';

export interface Order {
  phoneNumber: string;
  phoneNumberAlt?: string;
  email: string;
  name: string;
  // Outros campos do Shopify podem ser adicionados aqui
  createdAt?: Date | Timestamp;
  updatedAt?: Date | Timestamp;
}
