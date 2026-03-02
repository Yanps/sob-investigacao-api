import {
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Body,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { Public } from '../common/decorators/public.decorator';
import { ChangePhoneDto } from './dto/change-phone.dto';
import { ActivateCodeDto } from './dto/activate-code.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async list(
    @Query('phoneNumber') phoneNumber?: string,
    @Query('email') email?: string,
    @Query('limit') limit?: string,
    @Query('startAfter') startAfter?: string,
  ) {
    const limitNum = limit
      ? Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100)
      : 20;
    return this.usersService.listCustomers({
      phoneNumber,
      email,
      limit: limitNum,
      startAfter,
    });
  }

  @Patch('change-phone')
  async changePhone(@Body() dto: ChangePhoneDto) {
    return this.usersService.changePhoneNumber(
      dto.email,
      dto.newPhoneNumber,
    );
  }

  @Get(':phoneNumber/name')
  async getCustomerName(@Param('phoneNumber') phoneNumber: string) {
    const name = await this.usersService.getCustomerNameByPhone(phoneNumber);
    return { name };
  }

  @Public()
  @Get(':phoneNumber/games')
  async listGames(@Param('phoneNumber') phoneNumber: string) {
    return this.usersService.listUserGames(phoneNumber);
  }

  @Post(':phoneNumber/reset-session')
  async resetSession(@Param('phoneNumber') phoneNumber: string) {
    return this.usersService.resetUserSession(phoneNumber);
  }

  @Public()
  @Post(':phoneNumber/activate')
  async activateCode(
    @Param('phoneNumber') phoneNumber: string,
    @Body() dto: ActivateCodeDto,
  ) {
    return this.usersService.activateCode(dto.codigoAtivacao, phoneNumber);
  }

  @Get(':phoneNumber')
  async getByPhone(@Param('phoneNumber') phoneNumber: string) {
    const result = await this.usersService.getUserByPhone(phoneNumber);
    if (!result.customer && result.ordersCount === 0 && result.games.length === 0) {
      throw new NotFoundException(
        `Nenhum usuário encontrado para o telefone: ${phoneNumber}`,
      );
    }
    return result;
  }
}
