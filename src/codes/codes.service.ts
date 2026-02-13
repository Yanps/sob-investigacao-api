import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { FIRESTORE } from '../infra/firebase/firebase.provider';
import { randomBytes } from 'crypto';

const COLLECTION = 'gift_cards';
const PREFIX = 'FL';
const SEGMENT_LENGTH = 4;
const SEGMENTS = 3;
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const MAX_QUANTITY = 1000;

function generateSegment(): string {
  const bytes = randomBytes(SEGMENT_LENGTH);
  let s = '';
  for (let i = 0; i < SEGMENT_LENGTH; i++) {
    s += CHARS[bytes[i]! % CHARS.length];
  }
  return s;
}

function generateCode(): string {
  const parts = [PREFIX];
  for (let i = 0; i < SEGMENTS; i++) {
    parts.push(generateSegment());
  }
  return parts.join('-');
}

@Injectable()
export class CodesService {
  private readonly logger = new Logger(CodesService.name);

  constructor(
    @Inject(FIRESTORE)
    private readonly firestore: Firestore,
  ) {}

  async generate(params: {
    productId: string;
    quantity: number;
    batchId?: string;
  }): Promise<{ codes: string[]; batchId: string }> {
    const quantity = Math.floor(params.quantity);
    if (quantity < 1 || quantity > MAX_QUANTITY) {
      throw new BadRequestException(
        `Quantidade deve ser entre 1 e ${MAX_QUANTITY}`,
      );
    }

    const productId = params.productId?.trim();
    if (!productId) {
      throw new BadRequestException('productId é obrigatório');
    }

    const batchId =
      params.batchId?.trim() ||
      `batch_${Date.now()}_${randomBytes(4).toString('hex')}`;

    const codes: string[] = [];
    const seen = new Set<string>();
    let attempts = 0;
    const maxAttempts = quantity * 10;

    while (codes.length < quantity && attempts < maxAttempts) {
      attempts++;
      const code = generateCode();
      if (seen.has(code)) continue;
      seen.add(code);

      const existing = await this.firestore
        .collection(COLLECTION)
        .where('code', '==', code)
        .limit(1)
        .get();
      if (!existing.empty) continue;

      codes.push(code);
    }

    if (codes.length < quantity) {
      throw new BadRequestException(
        `Não foi possível gerar ${quantity} códigos únicos. Gerados: ${codes.length}. Tente novamente.`,
      );
    }

    const batch = this.firestore.batch();
    const now = FieldValue.serverTimestamp();
    for (const code of codes) {
      const ref = this.firestore.collection(COLLECTION).doc();
      batch.set(ref, {
        code,
        used: false,
        batchId,
        productId,
        createdAt: now,
      });
    }
    await batch.commit();

    return { codes, batchId };
  }

  async list(params: {
    batchId?: string;
    used?: boolean;
    limit?: number;
    startAfter?: string;
  }): Promise<{
    codes: { id: string; code: string; used: boolean; usedAt?: unknown; usedByPhoneNumber?: string; batchId?: string; gameId?: string; createdAt?: unknown }[];
    nextCursor?: string;
  }> {
    this.logger.log(`list() called with params: ${JSON.stringify(params)}`);
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);

    try {
      let query = this.firestore
        .collection(COLLECTION)
        .orderBy('createdAt', 'desc')
        .limit(limit + 1);

      if (params.batchId?.trim()) {
        query = query.where('batchId', '==', params.batchId.trim());
      }
      if (params.used !== undefined) {
        query = query.where('used', '==', params.used);
      }
      if (params.startAfter) {
        const cursor = await this.firestore
          .collection(COLLECTION)
          .doc(params.startAfter)
          .get();
        if (cursor.exists) {
          query = query.startAfter(cursor);
        }
      }

      this.logger.log('Executing Firestore query...');
      const snapshot = await query.get();
      this.logger.log(`Query returned ${snapshot.docs.length} documents`);

      const docs = snapshot.docs.slice(0, limit);
      const codes = docs.map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          code: d.code,
          used: d.used === true,
          usedAt: d.usedAt,
          usedByPhoneNumber: d.usedByPhoneNumber,
          usedByName: d.usedByName,
          usedByEmail: d.usedByEmail,
          channel: d.channel,
          batchId: d.batchId,
          productId: d.productId,
          createdAt: d.createdAt,
        };
      });
      const nextCursor =
        snapshot.docs.length > limit ? snapshot.docs[limit - 1]?.id : undefined;
      return { codes, nextCursor };
    } catch (error) {
      this.logger.error(`Error in list(): ${error.message}`, error.stack);
      throw error;
    }
  }

  async listBatches(): Promise<{
    batches: { batchId: string; count: number }[];
  }> {
    const snapshot = await this.firestore.collection(COLLECTION).get();

    const batchCounts = new Map<string, number>();
    for (const doc of snapshot.docs) {
      const batchId = doc.data().batchId;
      if (batchId) {
        batchCounts.set(batchId, (batchCounts.get(batchId) || 0) + 1);
      }
    }

    const batches = Array.from(batchCounts.entries())
      .map(([batchId, count]) => ({ batchId, count }))
      .sort((a, b) => b.count - a.count);

    return { batches };
  }

  async getByCode(code: string): Promise<{
    id: string;
    code: string;
    used: boolean;
    usedAt?: unknown;
    usedByPhoneNumber?: string;
    usedByName?: string;
    usedByEmail?: string;
    channel?: string;
    batchId?: string;
    productId?: string;
    createdAt?: unknown;
  } | null> {
    const normalized = String(code).trim().toUpperCase();
    const snapshot = await this.firestore
      .collection(COLLECTION)
      .where('code', '==', normalized)
      .limit(1)
      .get();

    if (snapshot.empty) return null;
    const doc = snapshot.docs[0]!;
    const d = doc.data();
    return {
      id: doc.id,
      code: d.code,
      used: d.used === true,
      usedAt: d.usedAt,
      usedByPhoneNumber: d.usedByPhoneNumber,
      usedByName: d.usedByName,
      usedByEmail: d.usedByEmail,
      channel: d.channel,
      batchId: d.batchId,
      productId: d.productId,
      createdAt: d.createdAt,
    };
  }
}
