import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { FIRESTORE } from '../infra/firebase/firebase.provider';
import type { Game } from '../shared/types/game.schema';
import type { CreateGameDto } from './dto/create-game.dto';
import type { UpdateGameDto } from './dto/update-game.dto';

const GAMES_COLLECTION = 'games';
const ORDERS_COLLECTION = 'orders';
const CHATS_COLLECTION = 'chats';

interface GameResponse {
  id: string;
  name: string;
  type: string;
  prompts?: Record<string, unknown>;
  config?: Record<string, unknown>;
  active: boolean;
  createdAt: string;
  updatedAt?: string;
}

function toISOString(value: unknown): string | undefined {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return undefined;
}

function toGameResponse(id: string, data: Game): GameResponse {
  return {
    id,
    name: data.name,
    type: data.type,
    prompts: data.prompts,
    config: data.config,
    active: data.active,
    createdAt: toISOString(data.createdAt) ?? new Date().toISOString(),
    updatedAt: toISOString(data.updatedAt),
  };
}

function normalizePhone(raw: string): string {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) return '55' + digits;
  return digits;
}

@Injectable()
export class GamesService {
  constructor(
    @Inject(FIRESTORE)
    private readonly firestore: Firestore,
  ) {}

  async list(params?: {
    active?: boolean;
    type?: string;
    limit?: number;
    startAfter?: string;
  }): Promise<{ games: GameResponse[]; nextCursor?: string }> {
    const limit = Math.min(Math.max(params?.limit ?? 50, 1), 100);
    let query = this.firestore
      .collection(GAMES_COLLECTION)
      .orderBy('createdAt', 'desc')
      .limit(limit + 1);

    if (params?.active !== undefined) {
      query = query.where('active', '==', params.active);
    }
    if (params?.type?.trim()) {
      query = query.where('type', '==', params.type.trim());
    }
    if (params?.startAfter) {
      const cursor = await this.firestore
        .collection(GAMES_COLLECTION)
        .doc(params.startAfter)
        .get();
      if (cursor.exists) query = query.startAfter(cursor);
    }

    const snapshot = await query.get();
    const docs = snapshot.docs.slice(0, limit);
    const games = docs.map((d) => toGameResponse(d.id, d.data() as Game));
    const nextCursor =
      snapshot.docs.length > limit ? snapshot.docs[limit - 1]?.id : undefined;
    return { games, nextCursor };
  }

  async getById(gameId: string): Promise<GameResponse | null> {
    const doc = await this.firestore.collection(GAMES_COLLECTION).doc(gameId).get();
    if (!doc.exists) return null;
    return toGameResponse(doc.id, doc.data() as Game);
  }

  async create(dto: CreateGameDto): Promise<GameResponse> {
    const now = FieldValue.serverTimestamp();
    const ref = await this.firestore.collection(GAMES_COLLECTION).add({
      name: dto.name,
      type: dto.type ?? 'default',
      prompts: dto.prompts ?? {},
      config: dto.config ?? {},
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    const snap = await ref.get();
    return toGameResponse(snap.id, snap.data() as Game);
  }

  async update(
    gameId: string,
    dto: UpdateGameDto,
  ): Promise<GameResponse> {
    const ref = this.firestore.collection(GAMES_COLLECTION).doc(gameId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new NotFoundException(`Game ${gameId} not found`);
    }
    const updates: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.type !== undefined) updates.type = dto.type;
    if (dto.prompts !== undefined) updates.prompts = dto.prompts;
    if (dto.config !== undefined) updates.config = dto.config;
    if (dto.active !== undefined) updates.active = dto.active;
    await ref.update(updates);
    const updated = await ref.get();
    return toGameResponse(updated.id, updated.data() as Game);
  }

  async delete(gameId: string): Promise<void> {
    const ref = this.firestore.collection(GAMES_COLLECTION).doc(gameId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new NotFoundException(`Game ${gameId} not found`);
    }
    await ref.update({
      active: false,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  async activate(
    gameId: string,
    phoneNumber: string,
    source: 'shopify' | 'code',
  ): Promise<{ success: boolean; message: string }> {
    const game = await this.getById(gameId);
    if (!game) {
      throw new NotFoundException(`Game ${gameId} not found`);
    }
    if (!game.active) {
      throw new BadRequestException(`Game ${gameId} is not active`);
    }
    const normalized = normalizePhone(phoneNumber);
    if (!normalized || normalized.length < 10) {
      throw new BadRequestException('Invalid phone number');
    }

    const existing = await this.firestore
      .collection(ORDERS_COLLECTION)
      .where('phoneNumber', '==', normalized)
      .where('gameId', '==', gameId)
      .where('source', '==', 'game_activation')
      .limit(1)
      .get();

    if (!existing.empty) {
      throw new ConflictException(
        `Game ${gameId} is already activated for this phone number`,
      );
    }

    const orderRef = this.firestore.collection(ORDERS_COLLECTION).doc();
    await orderRef.set({
      orderId: `game_${gameId}_${orderRef.id}`,
      phoneNumber: normalized,
      phoneNumberAlt: normalized,
      email: null,
      name: null,
      products: [game.name],
      source: 'game_activation',
      gameId,
      createdAt: FieldValue.serverTimestamp(),
    });

    const chatRef = this.firestore.collection(CHATS_COLLECTION).doc(normalized);
    const chatSnap = await chatRef.get();
    const lastMessage = chatSnap.exists
      ? { ...(chatSnap.data()?.lastMessage as Record<string, unknown>), gameType: gameId }
      : { gameType: gameId };
    if (chatSnap.exists) {
      await chatRef.update({
        lastMessage,
        lastUpdated: FieldValue.serverTimestamp(),
      });
    } else {
      await chatRef.set({
        createdAt: FieldValue.serverTimestamp(),
        lastMessage,
        lastUpdated: FieldValue.serverTimestamp(),
      });
    }

    return {
      success: true,
      message: `Game "${game.name}" activated for phone ${normalized}`,
    };
  }

  async deactivate(gameId: string, phoneNumber: string): Promise<void> {
    const normalized = normalizePhone(phoneNumber);
    const snapshot = await this.firestore
      .collection(ORDERS_COLLECTION)
      .where('phoneNumber', '==', normalized)
      .where('gameId', '==', gameId)
      .where('source', '==', 'game_activation')
      .get();

    if (snapshot.empty) {
      throw new NotFoundException(
        `No active game ${gameId} found for this phone number`,
      );
    }

    const batch = this.firestore.batch();
    for (const doc of snapshot.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();

    const chatRef = this.firestore.collection(CHATS_COLLECTION).doc(normalized);
    const chatSnap = await chatRef.get();
    if (chatSnap.exists) {
      const data = chatSnap.data() ?? {};
      const lastMessage = data.lastMessage as Record<string, unknown> | undefined;
      if (lastMessage?.gameType === gameId) {
        const { gameType: _, ...rest } = lastMessage;
        await chatRef.update({
          lastMessage: Object.keys(rest).length ? rest : null,
          lastUpdated: FieldValue.serverTimestamp(),
        });
      }
    }
  }
}
