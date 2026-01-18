import { Controller, Get, Param, Post, Body } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':userId/games')
  listGames(@Param('userId') userId: string) {
    return this.usersService.listGames(userId);
  }

  @Post('change-phone')
  changePhone(@Body() body: { oldPhone: string; newPhone: string }) {
    return this.usersService.changePhone(body);
  }
}
