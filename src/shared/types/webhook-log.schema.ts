import { Timestamp } from 'firebase-admin/firestore';

export interface WebhookLog {
  payload: any;
  traceId: string;
  phoneNumber: string;
  messageId: string;
  text: string | null;
  createdAt: Date | Timestamp;
}
