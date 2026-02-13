import { Injectable, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FIRESTORE } from '../infra/firebase/firebase.provider';
import type { AgentResponse } from '../shared/types/agent-response.schema';
import type { Conversation } from '../shared/types/conversation.schema';
import type { Chat, ChatMessage, MessageInArray } from '../shared/types/chat.schema';

const RESPONSES_COLLECTION = 'agent_responses';
const CONVERSATIONS_COLLECTION = 'conversations';
const CHATS_COLLECTION = 'chats';
const CUSTOMERS_COLLECTION = 'customers';
const LAST_MESSAGE_PREVIEW_MAX = 80;

/** Normaliza telefone para consulta: só dígitos; 10 ou 11 dígitos → prefixa 55. */
function normalizePhoneForQuery(raw: string): string {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) return '55' + digits;
  return digits;
}

function extractLastMessagePreview(chat: Chat): string | null {
  if (chat.lastMessage?.msgBody) {
    const s = String(chat.lastMessage.msgBody).trim();
    return s.length > LAST_MESSAGE_PREVIEW_MAX ? s.slice(0, LAST_MESSAGE_PREVIEW_MAX) + '…' : s;
  }
  if (chat.messages && chat.messages.length > 0) {
    const last = chat.messages[chat.messages.length - 1] as MessageInArray;
    const s = String(last?.msgBody ?? '').trim();
    return s.length > LAST_MESSAGE_PREVIEW_MAX ? s.slice(0, LAST_MESSAGE_PREVIEW_MAX) + '…' : s || null;
  }
  return null;
}

function extractGameType(chat: Chat): string | undefined {
  if (chat.lastMessage?.gameType) return chat.lastMessage.gameType;
  if (chat.messages && chat.messages.length > 0) {
    const last = chat.messages[chat.messages.length - 1] as MessageInArray;
    return last?.gameType;
  }
  return undefined;
}

@Injectable()
export class AgentService {
  constructor(
    @Inject(FIRESTORE)
    private readonly firestore: Firestore,
  ) {}

  async getResponsesByPhone(
    phoneNumber: string,
    params?: { limit?: number; startAfter?: string },
  ): Promise<{ responses: (AgentResponse & { id: string })[]; nextCursor?: string }> {
    const limit = Math.min(Math.max(params?.limit ?? 50, 1), 100);
    let query = this.firestore
      .collection(RESPONSES_COLLECTION)
      .where('phoneNumber', '==', phoneNumber)
      .orderBy('createdAt', 'desc')
      .limit(limit + 1);

    if (params?.startAfter) {
      const cursorDoc = await this.firestore
        .collection(RESPONSES_COLLECTION)
        .doc(params.startAfter)
        .get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    const snapshot = await query.get();
    const docs = snapshot.docs.slice(0, limit);
    const responses = docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        traceId: d.traceId,
        phoneNumber: d.phoneNumber,
        question: d.question,
        response: d.response,
        createdAt: d.createdAt,
        source: d.source ?? 'vertex-ai',
      };
    });
    const nextCursor =
      snapshot.docs.length > limit ? snapshot.docs[limit - 1]?.id : undefined;
    return { responses, nextCursor };
  }

  async getConversationsByPhone(
    phoneNumber: string,
    params?: { limit?: number; status?: 'active' | 'closed'; startAfter?: string },
  ): Promise<{ conversations: (Conversation & { id: string })[]; nextCursor?: string }> {
    const normalized = normalizePhoneForQuery(phoneNumber);
    const limit = Math.min(Math.max(params?.limit ?? 50, 1), 100);
    let query = this.firestore
      .collection(CONVERSATIONS_COLLECTION)
      .where('phoneNumber', '==', normalized)
      .orderBy('lastMessageAt', 'desc')
      .limit(limit + 1);

    if (params?.status) {
      query = query.where('status', '==', params.status);
    }
    if (params?.startAfter) {
      const cursorDoc = await this.firestore
        .collection(CONVERSATIONS_COLLECTION)
        .doc(params.startAfter)
        .get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    const snapshot = await query.get();
    const docs = snapshot.docs.slice(0, limit);
    const conversations = docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        conversationId: doc.id,
        phoneNumber: d.phoneNumber,
        agentPhoneNumberId: d.agentPhoneNumberId,
        adkSessionId: d.adkSessionId ?? null,
        status: d.status,
        startedAt: d.startedAt,
        lastMessageAt: d.lastMessageAt,
        closedAt: d.closedAt ?? null,
      };
    });
    const nextCursor = snapshot.docs.length > limit ? docs[docs.length - 1]?.id : undefined;
    return { conversations, nextCursor };
  }

  /**
   * Lista todas as conversas (para dashboard), ordenadas por lastMessageAt desc.
   * Opcional: enriquecer com contactName (customers), lastMessagePreview e tags (chats/gameType).
   */
  async listAllConversations(params: {
    limit?: number;
    startAfter?: string;
    status?: 'active' | 'closed';
    enrich?: boolean;
  }): Promise<{
    conversations: Array<
      (Conversation & { id: string }) & {
        contactName?: string | null;
        lastMessagePreview?: string | null;
        tags?: string[];
      }
    >;
    nextCursor?: string;
  }> {
    const limit = Math.min(Math.max(params?.limit ?? 50, 1), 100);
    let query = this.firestore
      .collection(CONVERSATIONS_COLLECTION)
      .orderBy('lastMessageAt', 'desc')
      .limit(limit + 1);

    if (params?.status) {
      query = query.where('status', '==', params.status);
    }
    if (params?.startAfter) {
      const cursorDoc = await this.firestore
        .collection(CONVERSATIONS_COLLECTION)
        .doc(params.startAfter)
        .get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    const snapshot = await query.get();
    const docs = snapshot.docs.slice(0, limit);
    const baseList = docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        conversationId: doc.id,
        phoneNumber: d.phoneNumber,
        agentPhoneNumberId: d.agentPhoneNumberId,
        adkSessionId: d.adkSessionId ?? null,
        status: d.status,
        startedAt: d.startedAt,
        lastMessageAt: d.lastMessageAt,
        closedAt: d.closedAt ?? null,
      };
    });
    const nextCursor = snapshot.docs.length > limit ? docs[docs.length - 1]?.id : undefined;

    if (!params?.enrich) {
      return { conversations: baseList, nextCursor };
    }

    const enriched = await Promise.all(
      baseList.map(async (conv) => {
        let contactName: string | null = null;
        let lastMessagePreview: string | null = null;
        const tags: string[] = [];

        const phone = conv.phoneNumber;

        const [byPhone, byAlt, chatSnap] = await Promise.all([
          this.firestore.collection(CUSTOMERS_COLLECTION).where('phoneNumber', '==', phone).limit(1).get(),
          this.firestore.collection(CUSTOMERS_COLLECTION).where('phoneNumberAlt', '==', phone).limit(1).get(),
          this.firestore.collection(CHATS_COLLECTION).doc(phone).get(),
        ]);
        const customerSnap = byPhone.docs[0] ?? byAlt.docs[0];

        if (customerSnap?.data()) {
          contactName = (customerSnap.data() as { name?: string }).name ?? null;
        }
        if (chatSnap?.exists) {
          const chat = chatSnap.data() as Chat;
          lastMessagePreview = extractLastMessagePreview(chat);
          const gameType = extractGameType(chat);
          if (gameType) tags.push(gameType);
        }

        return {
          ...conv,
          contactName: contactName ?? undefined,
          lastMessagePreview: lastMessagePreview ?? undefined,
          tags: tags.length > 0 ? tags : undefined,
        };
      }),
    );

    return { conversations: enriched, nextCursor };
  }

  async getConversationById(
    conversationId: string,
  ): Promise<(Conversation & { id: string }) | null> {
    const doc = await this.firestore
      .collection(CONVERSATIONS_COLLECTION)
      .doc(conversationId)
      .get();
    if (!doc.exists) return null;
    const d = doc.data()!;
    return {
      id: doc.id,
      conversationId: doc.id,
      phoneNumber: d.phoneNumber,
      agentPhoneNumberId: d.agentPhoneNumberId,
      adkSessionId: d.adkSessionId ?? null,
      status: d.status,
      startedAt: d.startedAt,
      lastMessageAt: d.lastMessageAt,
      closedAt: d.closedAt ?? null,
    };
  }

  /**
   * Mensagens da conversa: retorna as respostas do agente para o telefone dessa conversa.
   * (agent_responses não têm conversationId; filtramos por phoneNumber da conversa.)
   */
  async getConversationMessages(
    conversationId: string,
    params?: { limit?: number },
  ): Promise<{ conversation: Conversation & { id: string }; messages: (AgentResponse & { id: string })[] }> {
    console.log('[getConversationMessages] conversationId:', conversationId, 'params:', JSON.stringify(params));
    try {
      const conversation = await this.getConversationById(conversationId);
      console.log('[getConversationMessages] conversation found:', conversation ? 'yes' : 'no');
      if (!conversation) {
        throw new NotFoundException(`Conversation ${conversationId} not found`);
      }
      console.log('[getConversationMessages] phoneNumber:', conversation.phoneNumber);

      const limit = Math.min(Math.max(params?.limit ?? 50, 1), 100);
      console.log('[getConversationMessages] querying responses with limit:', limit);

      const snapshot = await this.firestore
        .collection(RESPONSES_COLLECTION)
        .where('phoneNumber', '==', conversation.phoneNumber)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      console.log('[getConversationMessages] responses found:', snapshot.docs.length);

      const messages = snapshot.docs.map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          traceId: d.traceId,
          phoneNumber: d.phoneNumber,
          question: d.question,
          response: d.response,
          createdAt: d.createdAt,
          source: d.source ?? 'vertex-ai',
        };
      });

      console.log('[getConversationMessages] returning', messages.length, 'messages');
      return { conversation, messages };
    } catch (error) {
      console.error('[getConversationMessages] ERROR:', error);
      throw error;
    }
  }
}
