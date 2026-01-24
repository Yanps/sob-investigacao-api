import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
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
   *
   * Estratégia:
   * 1. Verifica se o customer existe no telefone antigo
   * 2. Verifica se já existe chat/customer no telefone novo (evita conflitos)
   * 3. Migra o chat (cria novo documento, deleta o antigo)
   * 4. Atualiza o customer (novo phoneNumber, mantém antigo como phoneNumberAlt)
   *
   * Usa batch write para garantir atomicidade o máximo possível.
   * Preserva ambas as estruturas (lastMessage e messages array).
   */
  async changePhoneNumber(
    oldPhoneNumber: string,
    newPhoneNumber: string,
  ): Promise<{ success: boolean; message: string }> {
    // Validação básica
    if (oldPhoneNumber === newPhoneNumber) {
      throw new BadRequestException(
        'O telefone antigo e o novo não podem ser iguais',
      );
    }

    // Normaliza os números (remove espaços, caracteres especiais se necessário)
    const normalizedOld = oldPhoneNumber.trim();
    const normalizedNew = newPhoneNumber.trim();

    // Busca o customer no telefone antigo
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

    // 1. Atualiza o customer: novo phoneNumber, mantém antigo como phoneNumberAlt
    const customerRef = this.firestore
      .collection('customers')
      .doc(customerDoc.id);

    batch.update(customerRef, {
      phoneNumber: normalizedNew,
      phoneNumberAlt: normalizedOld,
    });

    // 2. Se existe chat, migra para o novo telefone
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
