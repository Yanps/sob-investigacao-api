import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  NotFoundException,
} from '@nestjs/common';
import { GamesService } from './games.service';
import { CreateGameDto } from './dto/create-game.dto';
import { UpdateGameDto } from './dto/update-game.dto';
import { ActivateGameDto } from './dto/activate-game.dto';

@Controller('games')
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  @Get()
  list(
    @Query('active') active?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
    @Query('startAfter') startAfter?: string,
  ) {
    const activeBool =
      active === undefined ? undefined : active === 'true';
    const limitNum = limit
      ? Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100)
      : 50;
    return this.gamesService.list({
      active: activeBool,
      type,
      limit: limitNum,
      startAfter,
    });
  }

  @Get(':gameId')
  async getById(@Param('gameId') gameId: string) {
    const game = await this.gamesService.getById(gameId);
    if (!game) {
      throw new NotFoundException(`Game ${gameId} not found`);
    }
    return { game };
  }

  @Post()
  create(@Body() dto: CreateGameDto) {
    return this.gamesService.create(dto);
  }

  @Put(':gameId')
  update(@Param('gameId') gameId: string, @Body() dto: UpdateGameDto) {
    return this.gamesService.update(gameId, dto);
  }

  @Delete(':gameId')
  async delete(@Param('gameId') gameId: string) {
    await this.gamesService.delete(gameId);
    return { success: true, message: 'Game deactivated' };
  }

  @Post(':gameId/activate')
  activate(
    @Param('gameId') gameId: string,
    @Body() dto: ActivateGameDto,
  ) {
    return this.gamesService.activate(
      gameId,
      dto.phoneNumber,
      dto.source,
    );
  }

  @Post(':gameId/deactivate')
  deactivate(
    @Param('gameId') gameId: string,
    @Body() body: { phoneNumber: string },
  ) {
    return this.gamesService.deactivate(gameId, body.phoneNumber);
  }
}
