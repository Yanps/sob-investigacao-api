import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Firestore, FieldPath } from 'firebase-admin/firestore';
import { FIRESTORE } from '../infra/firebase/firebase.provider';
import type { Chat } from '../shared/types/chat.schema';
import type { Customer } from '../shared/types/customer.schema';

@Injectable()
export class UsersService {
  constructor(
    @Inject(FIRESTORE)
    private readonly firestore: Firestore,
  ) {}

  /**
   * Extrai o gameType de um chat, suportando ambas as estruturas:
   * - lastMessage.gameType (estrutura com objeto único)
   * - messages[lastIndex].gameType (estrutura com array)
   */
  private extractGameType(chat: Chat): string | undefined {
    // Tenta estrutura 1: lastMessage
    if (chat.lastMessage?.gameType) {
      return chat.lastMessage.gameType;
    }

    // Tenta estrutura 2: messages array
    if (chat.messages && chat.messages.length > 0) {
      // Pega a última mensagem do array
      const lastMessage = chat.messages[chat.messages.length - 1];
      return lastMessage.gameType;
    }

    return undefined;
  }

  /**
   * Lista clientes (customers) com paginação.
   * Filtros opcionais: phoneNumber (exato), email (exato, busca por doc id).
   */
  async listCustomers(params: {
    phoneNumber?: string;
    email?: string;
    limit?: number;
    startAfter?: string;
  }): Promise<{
    customers: (Customer & { id: string })[];
    nextCursor?: string;
  }> {
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);

    if (params.email?.trim()) {
      const emailPrefix = params.email.trim().toLowerCase();
      const snapshot = await this.firestore
        .collection('customers')
        .orderBy(FieldPath.documentId())
        .startAt(emailPrefix)
        .endAt(emailPrefix + '\uf8ff')
        .limit(limit + 1)
        .get();

      const docs = snapshot.docs.slice(0, limit);
      const customers = docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Customer),
      }));
      const nextCursor =
        snapshot.docs.length > limit ? snapshot.docs[limit - 1]?.id : undefined;
      return { customers, nextCursor };
    }

    // Se busca por phoneNumber, não usa orderBy para evitar necessidade de índice composto
    // (busca por phoneNumber geralmente retorna apenas 1 resultado)
    if (params.phoneNumber?.trim()) {
      const phoneQuery = this.firestore
        .collection('customers')
        .where('phoneNumber', '==', params.phoneNumber.trim())
        .limit(limit + 1);

      const snapshot = await phoneQuery.get();
      const docs = snapshot.docs.slice(0, limit);
      const customers = docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Customer),
      }));
      return { customers };
    }

    let query = this.firestore
      .collection('customers')
      .orderBy('createdAt', 'desc')
      .limit(limit + 1);

    if (params.startAfter) {
      const cursor = await this.firestore
        .collection('customers')
        .doc(params.startAfter)
        .get();
      if (cursor.exists) {
        query = query.startAfter(cursor);
      }
    }

    const snapshot = await query.get();
    const docs = snapshot.docs.slice(0, limit);
    const customers = docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Customer),
    }));
    const nextCursor =
      snapshot.docs.length > limit ? snapshot.docs[limit - 1]?.id : undefined;
    return { customers, nextCursor };
  }

  /**
   * Detalhe do usuário por telefone: customer + jogos + resumo de pedidos.
   */
  async getUserByPhone(phoneNumber: string): Promise<{
    customer: (Customer & { id: string }) | null;
    games: string[];
    ordersCount: number;
  }> {
    const normalized = String(phoneNumber).trim();
    const byPhone = await this.firestore
      .collection('customers')
      .where('phoneNumber', '==', normalized)
      .limit(1)
      .get();
    const byAlt = await this.firestore
      .collection('customers')
      .where('phoneNumberAlt', '==', normalized)
      .limit(1)
      .get();

    const customerDoc = byPhone.docs[0] ?? byAlt.docs[0];
    const customer: (Customer & { id: string }) | null = customerDoc
      ? { id: customerDoc.id, ...(customerDoc.data() as Customer) }
      : null;

    const games = await this.listUserGames(normalized);

    const ordersSnap = await this.firestore
      .collection('orders')
      .where('phoneNumber', '==', normalized)
      .get();
    const ordersAltSnap = await this.firestore
      .collection('orders')
      .where('phoneNumberAlt', '==', normalized)
      .get();
    const ordersCount = ordersSnap.size + ordersAltSnap.size;
    const seen = new Set<string>();
    for (const d of ordersSnap.docs) {
      seen.add(d.id);
    }
    for (const d of ordersAltSnap.docs) {
      if (!seen.has(d.id)) seen.add(d.id);
    }
    const uniqueOrdersCount = seen.size;

    return {
      customer,
      games,
      ordersCount: uniqueOrdersCount,
    };
  }

  async listUserGames(phoneNumber: string): Promise<string[]> {
    const snap = await this.firestore
      .collection('chats')
      .doc(phoneNumber)
      .get();

    if (!snap.exists) {
      return [];
    }

    const data = snap.data() as Chat | undefined;

    if (!data) {
      return [];
    }

    const gameType = this.extractGameType(data);

    return gameType ? [gameType] : [];
  }

  /**
   * Migra o telefone do usuário preservando o histórico de mensagens.
   * Busca o usuário pelo email na collection 'orders' e atualiza o telefone.
   *
   * Estratégia:
   * 1. Busca na collection 'orders' pelo email para obter o phoneNumber atual
   * 2. Busca o customer na collection 'customers' usando o phoneNumber
   * 3. Verifica se já existe chat/customer no telefone novo (evita conflitos)
   * 4. Migra o chat (cria novo documento, deleta o antigo)
   * 5. Atualiza o customer e order (novo phoneNumber, mantém antigo como phoneNumberAlt)
   *
   * Usa batch write para garantir atomicidade o máximo possível.
   * Preserva ambas as estruturas (lastMessage e messages array).
   */
  async changePhoneNumber(
    email: string,
    newPhoneNumber: string,
  ): Promise<{ success: boolean; message: string }> {
    // Normaliza o email e telefone
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedNew = newPhoneNumber.trim();

    // 1. Busca na collection 'orders' pelo email para obter o phoneNumber atual
    const orderSnap = await this.firestore
      .collection('orders')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();

    if (orderSnap.empty) {
      throw new NotFoundException(
        `Order não encontrado para o email: ${normalizedEmail}`,
      );
    }

    const orderData = orderSnap.docs[0].data();
    const oldPhoneNumber = orderData.phoneNumber as string;

    if (!oldPhoneNumber) {
      throw new NotFoundException(
        `PhoneNumber não encontrado no order para o email: ${normalizedEmail}`,
      );
    }

    const normalizedOld = oldPhoneNumber.toString().trim();

    // Validação básica
    if (normalizedOld === normalizedNew) {
      throw new BadRequestException(
        'O telefone novo não pode ser igual ao telefone atual',
      );
    }

    // 2. Busca o customer na collection 'customers' usando o phoneNumber
    const customerSnap = await this.firestore
      .collection('customers')
      .where('phoneNumber', '==', normalizedOld)
      .limit(1)
      .get();

    if (customerSnap.empty) {
      throw new NotFoundException(
        `Customer não encontrado para o telefone: ${normalizedOld}`,
      );
    }

    const customerDoc = customerSnap.docs[0];

    // Verifica se já existe customer no telefone novo
    const existingCustomerSnap = await this.firestore
      .collection('customers')
      .where('phoneNumber', '==', normalizedNew)
      .limit(1)
      .get();

    if (!existingCustomerSnap.empty) {
      throw new ConflictException(
        `Já existe um customer com o telefone: ${normalizedNew}`,
      );
    }

    // Verifica se já existe chat no telefone novo
    const existingChatSnap = await this.firestore
      .collection('chats')
      .doc(normalizedNew)
      .get();

    if (existingChatSnap.exists) {
      throw new ConflictException(
        `Já existe um chat com o telefone: ${normalizedNew}`,
      );
    }

    // Busca o chat no telefone antigo
    const oldChatSnap = await this.firestore
      .collection('chats')
      .doc(normalizedOld)
      .get();

    // Prepara o batch write para operações atômicas
    const batch = this.firestore.batch();

    // 3. Atualiza o customer: novo phoneNumber, mantém antigo como phoneNumberAlt
    const customerRef = this.firestore
      .collection('customers')
      .doc(customerDoc.id);

    batch.update(customerRef, {
      phoneNumber: normalizedNew,
      phoneNumberAlt: normalizedOld,
    });

    // 4. Atualiza o order com o novo phoneNumber
    const orderRef = this.firestore
      .collection('orders')
      .doc(orderSnap.docs[0].id);

    batch.update(orderRef, {
      phoneNumber: normalizedNew,
      phoneNumberAlt: normalizedOld,
    });

    // 5. Se existe chat, migra para o novo telefone
    // Preserva TODA a estrutura (lastMessage, messages array, etc)
    if (oldChatSnap.exists) {
      const chatData = oldChatSnap.data() as Chat | undefined;

      if (chatData) {
        // Cria o chat no novo telefone preservando toda a estrutura
        const newChatRef = this.firestore
          .collection('chats')
          .doc(normalizedNew);

        batch.set(newChatRef, chatData);

        // Deleta o chat antigo
        const oldChatRef = this.firestore
          .collection('chats')
          .doc(normalizedOld);

        batch.delete(oldChatRef);
      }
    }

    // Executa o batch (todas as operações ou nenhuma)
    await batch.commit();

    return {
      success: true,
      message: `Telefone migrado com sucesso de ${normalizedOld} para ${normalizedNew}`,
    };
  }
}
