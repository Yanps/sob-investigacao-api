import { Controller, Post, Body, Get, Query, Inject } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { ModerationService, ModerationResult } from './moderation.service';
import { Public } from '../common/decorators/public.decorator';
import { FIRESTORE } from '../infra/firebase/firebase.provider';
import type { Chat, MessageInArray, ChatMessage } from '../shared/types/chat.schema';

class AnalyzeMessageDto {
  text: string;
}

class AnalyzeBatchDto {
  messages: Array<{ id?: string; text: string }>;
}

const CHATS_COLLECTION = 'chats';

@Controller('moderation')
export class ModerationController {
  constructor(
    private readonly moderationService: ModerationService,
    @Inject(FIRESTORE)
    private readonly firestore: Firestore,
  ) {}

  /**
   * Analisa uma mensagem e retorna os flags de moderação
   * POST /api/moderation/analyze
   */
  @Post('analyze')
  @Public()
  analyzeMessage(@Body() dto: AnalyzeMessageDto): ModerationResult {
    return this.moderationService.analyzeMessage(dto.text);
  }

  /**
   * Versão GET para testes rápidos
   * GET /api/moderation/analyze?text=...
   */
  @Get('analyze')
  @Public()
  analyzeMessageGet(@Query('text') text: string): ModerationResult {
    return this.moderationService.analyzeMessage(text ?? '');
  }

  /**
   * Analisa múltiplas mensagens de uma vez
   * POST /api/moderation/analyze-batch
   */
  @Post('analyze-batch')
  @Public()
  analyzeBatch(
    @Body() dto: AnalyzeBatchDto,
  ): Array<{ id?: string; text: string } & ModerationResult> {
    return dto.messages.map((msg) => ({
      ...msg,
      ...this.moderationService.analyzeMessage(msg.text),
    }));
  }

  /**
   * Retorna apenas os flags booleanos (para pipelines)
   * POST /api/moderation/flags
   */
  @Post('flags')
  @Public()
  getFlags(@Body() dto: AnalyzeMessageDto): { hasDirtyWord: boolean; hasGiveup: boolean } {
    return this.moderationService.getFlags(dto.text);
  }

  /**
   * Processa todos os chats existentes e atualiza os flags de moderação
   * POST /api/moderation/backfill
   *
   * Use com cuidado - pode demorar dependendo do volume de dados
   */
  @Post('backfill')
  async backfillChats(
    @Query('limit') limitParam?: string,
    @Query('dryRun') dryRunParam?: string,
  ): Promise<{
    processed: number;
    updated: number;
    errors: number;
    dryRun: boolean;
    details: Array<{
      chatId: string;
      messagesProcessed: number;
      dirtyWordsFound: number;
      giveupFound: number;
    }>;
  }> {
    const limit = limitParam ? parseInt(limitParam, 10) : 100;
    const dryRun = dryRunParam === 'true';

    const snapshot = await this.firestore
      .collection(CHATS_COLLECTION)
      .limit(limit)
      .get();

    let processed = 0;
    let updated = 0;
    let errors = 0;
    const details: Array<{
      chatId: string;
      messagesProcessed: number;
      dirtyWordsFound: number;
      giveupFound: number;
    }> = [];

    for (const doc of snapshot.docs) {
      try {
        const chat = doc.data() as Chat;
        let messagesProcessed = 0;
        let dirtyWordsFound = 0;
        let giveupFound = 0;
        let needsUpdate = false;

        // Processa array de mensagens
        if (chat.messages && chat.messages.length > 0) {
          const updatedMessages = chat.messages.map((msg) => {
            const m = msg as MessageInArray;
            const text = m.msgBody ?? '';
            const flags = this.moderationService.getFlags(text);
            messagesProcessed++;

            if (flags.hasDirtyWord) dirtyWordsFound++;
            if (flags.hasGiveup) giveupFound++;

            // Só atualiza se os flags mudaram
            if (m.hasDirtyWord !== flags.hasDirtyWord || m.hasGiveup !== flags.hasGiveup) {
              needsUpdate = true;
              return { ...m, ...flags };
            }
            return m;
          });

          if (needsUpdate && !dryRun) {
            await doc.ref.update({ messages: updatedMessages });
          }
        }

        // Processa lastMessage
        if (chat.lastMessage) {
          const lm = chat.lastMessage as ChatMessage;
          const text = lm.msgBody ?? '';
          const flags = this.moderationService.getFlags(text);
          messagesProcessed++;

          if (flags.hasDirtyWord) dirtyWordsFound++;
          if (flags.hasGiveup) giveupFound++;

          if (lm.hasDirtyWord !== flags.hasDirtyWord || lm.hasGiveup !== flags.hasGiveup) {
            needsUpdate = true;
            if (!dryRun) {
              await doc.ref.update({
                'lastMessage.hasDirtyWord': flags.hasDirtyWord,
                'lastMessage.hasGiveup': flags.hasGiveup,
              });
            }
          }
        }

        processed++;
        if (needsUpdate) updated++;

        details.push({
          chatId: doc.id,
          messagesProcessed,
          dirtyWordsFound,
          giveupFound,
        });
      } catch (err) {
        errors++;
        console.error(`Erro ao processar chat ${doc.id}:`, err);
      }
    }

    return {
      processed,
      updated,
      errors,
      dryRun,
      details,
    };
  }
}
