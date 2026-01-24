import { Controller, Get, Param, Patch, Body } from '@nestjs/common';
import { UsersService } from './users.service';
import { ChangePhoneDto } from './dto/change-phone.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':phoneNumber/games')
  async listGames(@Param('phoneNumber') phoneNumber: string) {
    return this.usersService.listUserGames(phoneNumber);
  }

  @Patch('change-phone')
  async changePhone(@Body() dto: ChangePhoneDto) {
    return this.usersService.changePhoneNumber(
      dto.oldPhoneNumber,
      dto.newPhoneNumber,
    );
  }
}
