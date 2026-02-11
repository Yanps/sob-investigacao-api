import { Timestamp } from 'firebase-admin/firestore';

export interface ProcessingJob {
  traceId: string;
  phoneNumber: string;
  messageId: string;
  text: string | null;
  conversationId: string;
  agentPhoneNumberId: string;
  sessionId: string | null;
  status: 'pending' | 'processing' | 'done' | 'failed';
  attempts: number;
  createdAt: Date | Timestamp;
  startedAt?: Date | Timestamp;
  finishedAt?: Date | Timestamp;
  failedAt?: Date | Timestamp;
  lastError?: string;
}
