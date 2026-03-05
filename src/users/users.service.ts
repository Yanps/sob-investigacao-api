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
      // Normaliza o telefone: remove caracteres não numéricos
      const phoneDigits = params.phoneNumber.replace(/\D/g, '');
      const phoneAsNumber = parseInt(phoneDigits, 10);

      // Busca tanto como número quanto como string (para cobrir ambos os casos)
      const [snapNumber, snapString] = await Promise.all([
        this.firestore
          .collection('customers')
          .where('phoneNumber', '==', phoneAsNumber)
          .limit(limit + 1)
          .get(),
        this.firestore
          .collection('customers')
          .where('phoneNumber', '==', phoneDigits)
          .limit(limit + 1)
          .get(),
      ]);

      // Combina resultados únicos
      const seen = new Set<string>();
      const allDocs = [...snapNumber.docs, ...snapString.docs].filter((doc) => {
        if (seen.has(doc.id)) return false;
        seen.add(doc.id);
        return true;
      });

      const docs = allDocs.slice(0, limit);
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
    // Normaliza o telefone: remove caracteres não numéricos
    const phoneDigits = phoneNumber.replace(/\D/g, '');
    const phoneAsNumber = parseInt(phoneDigits, 10);

    // Busca como número e como string para cobrir ambos os casos
    const [byPhoneNum, byPhoneStr, byAltNum, byAltStr] = await Promise.all([
      this.firestore
        .collection('customers')
        .where('phoneNumber', '==', phoneAsNumber)
        .limit(1)
        .get(),
      this.firestore
        .collection('customers')
        .where('phoneNumber', '==', phoneDigits)
        .limit(1)
        .get(),
      this.firestore
        .collection('customers')
        .where('phoneNumberAlt', '==', phoneAsNumber)
        .limit(1)
        .get(),
      this.firestore
        .collection('customers')
        .where('phoneNumberAlt', '==', phoneDigits)
        .limit(1)
        .get(),
    ]);

    const customerDoc =
      byPhoneNum.docs[0] ?? byPhoneStr.docs[0] ?? byAltNum.docs[0] ?? byAltStr.docs[0];
    const customer: (Customer & { id: string }) | null = customerDoc
      ? { id: customerDoc.id, ...(customerDoc.data() as Customer) }
      : null;

    const games = await this.listUserGames(phoneDigits);

    // Busca orders como número e string
    const [ordersSnapNum, ordersSnapStr, ordersAltSnapNum, ordersAltSnapStr] = await Promise.all([
      this.firestore.collection('orders').where('phoneNumber', '==', phoneAsNumber).get(),
      this.firestore.collection('orders').where('phoneNumber', '==', phoneDigits).get(),
      this.firestore.collection('orders').where('phoneNumberAlt', '==', phoneAsNumber).get(),
      this.firestore.collection('orders').where('phoneNumberAlt', '==', phoneDigits).get(),
    ]);
    // Conta orders únicos
    const seen = new Set<string>();
    for (const snap of [ordersSnapNum, ordersSnapStr, ordersAltSnapNum, ordersAltSnapStr]) {
      for (const d of snap.docs) {
        seen.add(d.id);
      }
    }
    const uniqueOrdersCount = seen.size;

    return {
      customer,
      games,
      ordersCount: uniqueOrdersCount,
    };
  }

  /**
   * Retorna apenas o nome do customer pelo telefone.
   * Busca na collection 'customers' por phoneNumber ou phoneNumberAlt.
   */
  async getCustomerNameByPhone(phoneNumber: string): Promise<string> {
    const phoneDigits = phoneNumber.replace(/\D/g, '');
    const phoneAsNumber = parseInt(phoneDigits, 10);

    const [byPhoneNum, byPhoneStr, byAltNum, byAltStr] = await Promise.all([
      this.firestore
        .collection('customers')
        .where('phoneNumber', '==', phoneAsNumber)
        .limit(1)
        .get(),
      this.firestore
        .collection('customers')
        .where('phoneNumber', '==', phoneDigits)
        .limit(1)
        .get(),
      this.firestore
        .collection('customers')
        .where('phoneNumberAlt', '==', phoneAsNumber)
        .limit(1)
        .get(),
      this.firestore
        .collection('customers')
        .where('phoneNumberAlt', '==', phoneDigits)
        .limit(1)
        .get(),
    ]);

    const customerDoc =
      byPhoneNum.docs[0] ?? byPhoneStr.docs[0] ?? byAltNum.docs[0] ?? byAltStr.docs[0];

    if (!customerDoc) {
      throw new NotFoundException(
        `Customer não encontrado para o telefone: ${phoneNumber}`,
      );
    }

    const data = customerDoc.data() as Customer;
    return data.name;
  }

  async listUserGames(phoneNumber: string): Promise<string[]> {
    // Normaliza o telefone: remove caracteres não numéricos
    const phoneDigits = phoneNumber.replace(/\D/g, '');
    const phoneAsNumber = parseInt(phoneDigits, 10);

    // Busca em ambas as collections para redundância
    const [chatSnap, ordersByPhoneNum, ordersByPhoneStr, ordersByAltNum, ordersByAltStr] = await Promise.all([
      this.firestore.collection('chats').doc(phoneDigits).get(),
      this.firestore.collection('orders').where('phoneNumber', '==', phoneAsNumber).get(),
      this.firestore.collection('orders').where('phoneNumber', '==', phoneDigits).get(),
      this.firestore.collection('orders').where('phoneNumberAlt', '==', phoneAsNumber).get(),
      this.firestore.collection('orders').where('phoneNumberAlt', '==', phoneDigits).get(),
    ]);

    const gameTypes = new Set<string>();

    // Extrai gameType de 'chats'
    if (chatSnap.exists) {
      const data = chatSnap.data() as Chat | undefined;
      if (data) {
        const gameType = this.extractGameType(data);
        if (gameType) gameTypes.add(gameType);
      }
    }

    // Extrai gameTypes de 'orders'
    const orderDocs = [ordersByPhoneNum, ordersByPhoneStr, ordersByAltNum, ordersByAltStr];
    const seen = new Set<string>();
    for (const snap of orderDocs) {
      for (const doc of snap.docs) {
        if (!seen.has(doc.id)) {
          seen.add(doc.id);
          const order = doc.data();
          const game = order.gameType ?? order.gameId;
          if (game) {
            gameTypes.add(game);
          }
        }
      }
    }

    return Array.from(gameTypes);
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

    // Normaliza para string e número (banco pode ter em qualquer formato)
    const normalizedOldStr = oldPhoneNumber.toString().trim();
    const normalizedOldDigits = normalizedOldStr.replace(/\D/g, '');
    const normalizedOldNum = parseInt(normalizedOldDigits, 10);

    const normalizedNewDigits = normalizedNew.replace(/\D/g, '');
    const normalizedNewNum = parseInt(normalizedNewDigits, 10);

    // Validação básica
    if (normalizedOldDigits === normalizedNewDigits) {
      throw new BadRequestException(
        'O telefone novo não pode ser igual ao telefone atual',
      );
    }

    // 2. Busca o customer na collection 'customers' usando o phoneNumber
    // Busca como número e como string para cobrir ambos os casos
    const [customerSnapNum, customerSnapStr] = await Promise.all([
      this.firestore
        .collection('customers')
        .where('phoneNumber', '==', normalizedOldNum)
        .limit(1)
        .get(),
      this.firestore
        .collection('customers')
        .where('phoneNumber', '==', normalizedOldDigits)
        .limit(1)
        .get(),
    ]);

    const customerDoc = customerSnapNum.docs[0] ?? customerSnapStr.docs[0];

    if (!customerDoc) {
      throw new NotFoundException(
        `Customer não encontrado para o telefone: ${normalizedOldStr}`,
      );
    }

    // Verifica se já existe customer no telefone novo (busca como número e string)
    const [existingCustomerSnapNum, existingCustomerSnapStr] = await Promise.all([
      this.firestore
        .collection('customers')
        .where('phoneNumber', '==', normalizedNewNum)
        .limit(1)
        .get(),
      this.firestore
        .collection('customers')
        .where('phoneNumber', '==', normalizedNewDigits)
        .limit(1)
        .get(),
    ]);

    if (!existingCustomerSnapNum.empty || !existingCustomerSnapStr.empty) {
      throw new ConflictException(
        `Já existe um customer com o telefone: ${normalizedNew}`,
      );
    }

    // Verifica se já existe chat no telefone novo (chats usam string como doc id)
    const existingChatSnap = await this.firestore
      .collection('chats')
      .doc(normalizedNewDigits)
      .get();

    if (existingChatSnap.exists) {
      throw new ConflictException(
        `Já existe um chat com o telefone: ${normalizedNew}`,
      );
    }

    // Busca o chat no telefone antigo
    const oldChatSnap = await this.firestore
      .collection('chats')
      .doc(normalizedOldDigits)
      .get();

    // Prepara o batch write para operações atômicas
    const batch = this.firestore.batch();

    // 3. Atualiza o customer: novo phoneNumber, mantém antigo como phoneNumberAlt
    const customerRef = this.firestore
      .collection('customers')
      .doc(customerDoc.id);

    batch.update(customerRef, {
      phoneNumber: normalizedNewNum,
      phoneNumberAlt: normalizedOldNum,
    });

    // 4. Atualiza o order com o novo phoneNumber
    const orderRef = this.firestore
      .collection('orders')
      .doc(orderSnap.docs[0].id);

    batch.update(orderRef, {
      phoneNumber: normalizedNewNum,
      phoneNumberAlt: normalizedOldNum,
    });

    // 5. Se existe chat, migra para o novo telefone
    // Preserva TODA a estrutura (lastMessage, messages array, etc)
    if (oldChatSnap.exists) {
      const chatData = oldChatSnap.data() as Chat | undefined;

      if (chatData) {
        // Cria o chat no novo telefone preservando toda a estrutura
        const newChatRef = this.firestore
          .collection('chats')
          .doc(normalizedNewDigits);

        batch.set(newChatRef, chatData);

        // Deleta o chat antigo
        const oldChatRef = this.firestore
          .collection('chats')
          .doc(normalizedOldDigits);

        batch.delete(oldChatRef);
      }
    }

    // Executa o batch (todas as operações ou nenhuma)
    await batch.commit();

    return {
      success: true,
      message: `Telefone migrado com sucesso de ${normalizedOldDigits} para ${normalizedNewDigits}`,
    };
  }

  /**
   * Reseta a sessão Vertex AI de um usuário encerrando a conversa ativa.
   * Ao fechar a conversa, o Worker automaticamente cria uma nova conversa
   * com adkSessionId null na próxima mensagem, gerando uma nova sessão Vertex AI.
   */
  async resetUserSession(phoneNumber: string): Promise<{ success: boolean; message: string }> {
    const phoneDigits = phoneNumber.replace(/\D/g, '');

    const snap = await this.firestore
      .collection('conversations')
      .where('phoneNumber', '==', phoneDigits)
      .where('status', '==', 'active')
      .orderBy('lastMessageAt', 'desc')
      .limit(1)
      .get();

    if (snap.empty) {
      throw new NotFoundException(
        `Nenhuma conversa ativa para o telefone: ${phoneDigits}`,
      );
    }

    await snap.docs[0].ref.update({
      status: 'closed',
      closedAt: new Date(),
    });

    return {
      success: true,
      message: 'Conversa encerrada com sucesso. Nova conversa e sessão serão criadas na próxima mensagem.',
    };
  }

  /**
   * Ativa um código de jogo para um usuário (via WhatsApp/agente Vertex AI).
   * Fluxo:
   * 1. Normaliza o telefone (strip non-digits + prefixar 55 se 10-11 dígitos)
   * 2. Busca o código em gift_cards e valida se não foi usado
   * 3. Busca o jogo via productId em games
   * 4. Marca o código como usado (used: true, usedAt, usedByPhoneNumber, channel: 'whatsapp')
   * 5. Cria order em 'orders' com source: 'game_activation'
   * 6. Upsert chat em 'chats/{phone}' com lastMessage.gameType = gameId
   * 7. Retorna sucesso com mensagem contendo o nome do jogo
   */
  async activateCode(
    codigoAtivacao: string,
    phoneNumber: string,
  ): Promise<{ success: boolean; message: string }> {
    // Normalizar código
    const normalizedCode = codigoAtivacao.trim().toUpperCase();

    // Normalizar telefone: strip non-digits
    const phoneDigits = phoneNumber.replace(/\D/g, '');

    // Adicionar 55 se 10 ou 11 dígitos (Brasil)
    let normalizedPhone = phoneDigits;
    if ((phoneDigits.length === 10 || phoneDigits.length === 11) && !phoneDigits.startsWith('55')) {
      normalizedPhone = '55' + phoneDigits;
    }

    // 1. Buscar código em gift_cards
    const codeSnap = await this.firestore
      .collection('gift_cards')
      .where('code', '==', normalizedCode)
      .limit(1)
      .get();

    if (codeSnap.empty) {
      throw new NotFoundException(
        `Código de ativação não encontrado: ${normalizedCode}`,
      );
    }

    const codeDoc = codeSnap.docs[0];
    const codeData = codeDoc.data() as any;

    // Validar que não foi usado
    if (codeData.used === true) {
      throw new ConflictException(
        'Código já foi utilizado',
      );
    }

    const productId = codeData.productId;

    // 2. Buscar jogo via productId
    const gameSnap = await this.firestore
      .collection('games')
      .where('productId', '==', productId)
      .where('active', '==', true)
      .limit(1)
      .get();

    if (gameSnap.empty) {
      throw new NotFoundException(
        `Jogo não encontrado para este código`,
      );
    }

    const gameDoc = gameSnap.docs[0];
    const gameId = gameDoc.id;
    const gameName = gameDoc.data().name;

    // 3. Marcar código como usado
    const { FieldValue } = await import('firebase-admin/firestore');
    await codeDoc.ref.update({
      used: true,
      usedAt: FieldValue.serverTimestamp(),
      usedByPhoneNumber: normalizedPhone,
      channel: 'whatsapp',
    });

    // 4. Criar order em 'orders'
    const orderRef = this.firestore.collection('orders').doc();
    await orderRef.set({
      orderId: `game_${gameId}_${orderRef.id}`,
      phoneNumber: normalizedPhone,
      phoneNumberAlt: normalizedPhone,
      email: null,
      name: null,
      products: [gameName],
      source: 'game_activation',
      gameType: gameId,
      createdAt: FieldValue.serverTimestamp(),
    });

    // 5. Upsert chat com lastMessage.gameType = gameId
    const chatRef = this.firestore.collection('chats').doc(phoneDigits);
    await chatRef.set(
      { lastMessage: { gameType: gameId } },
      { merge: true },
    );

    return {
      success: true,
      message: `Jogo ${gameName} ativado com sucesso!`,
    };
  }
}
