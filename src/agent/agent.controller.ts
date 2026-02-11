import { Controller, Get, Param, Query } from '@nestjs/common';
import { AgentService } from './agent.service';

@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Get('conversations')
  listAllConversations(
    @Query('limit') limit?: string,
    @Query('startAfter') startAfter?: string,
    @Query('status') status?: 'active' | 'closed',
    @Query('enrich') enrich?: string,
  ) {
    const limitNum = limit
      ? Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100)
      : 50;
    const enrichBool = enrich === 'true' || enrich === '1';
    return this.agentService.listAllConversations({
      limit: limitNum,
      startAfter,
      status,
      enrich: enrichBool,
    });
  }

  @Get('responses/:phoneNumber')
  getResponses(
    @Param('phoneNumber') phoneNumber: string,
    @Query('limit') limit?: string,
    @Query('startAfter') startAfter?: string,
  ) {
    const limitNum = limit
      ? Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100)
      : 50;
    return this.agentService.getResponsesByPhone(phoneNumber, {
      limit: limitNum,
      startAfter,
    });
  }

  @Get('conversations/:conversationId/messages')
  getConversationMessages(
    @Param('conversationId') conversationId: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit
      ? Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100)
      : 50;
    return this.agentService.getConversationMessages(conversationId, {
      limit: limitNum,
    });
  }

  @Get('conversations/:phoneNumber')
  getConversationsByPhone(
    @Param('phoneNumber') phoneNumber: string,
    @Query('limit') limit?: string,
    @Query('startAfter') startAfter?: string,
    @Query('status') status?: 'active' | 'closed',
  ) {
    const limitNum = limit
      ? Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100)
      : 50;
    return this.agentService.getConversationsByPhone(phoneNumber, {
      limit: limitNum,
      startAfter,
      status,
    });
  }
}
