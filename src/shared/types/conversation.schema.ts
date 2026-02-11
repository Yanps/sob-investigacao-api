import { Timestamp } from 'firebase-admin/firestore';

export interface Conversation {
  conversationId: string;
  phoneNumber: string;
  agentPhoneNumberId: string;
  adkSessionId: string | null;
  status: 'active' | 'closed';
  startedAt: Date | Timestamp;
  lastMessageAt: Date | Timestamp;
  closedAt: Date | Timestamp | null;
}
