import { Timestamp } from 'firebase-admin/firestore';

export interface AgentResponse {
  traceId: string;
  phoneNumber: string;
  question: string;
  response: {
    text: string;
  };
  createdAt: Date | Timestamp;
  source: 'vertex-ai' | string;
}
