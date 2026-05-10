import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAuthenticated } from '~/core/decorators';
import { CurrentUser } from '~/modules/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '~/modules/auth/strategies/jwt.strategy';
import { CreateFamilyChatMessageDto, QueryFamilyChatMessageDto } from '../dto';
import { FamilyService } from '../services/family.service';

@ApiTags('家庭群聊')
@ApiBearerAuth()
@AllowAuthenticated()
@Controller('family/chat/messages')
export class FamilyChatController {
  constructor(private readonly familyService: FamilyService) {}

  @Get()
  @ApiOperation({ summary: '获取家庭群聊消息' })
  async findMessages(@Query() query: QueryFamilyChatMessageDto) {
    return this.familyService.findChatMessages(query);
  }

  @Post()
  @ApiOperation({ summary: '发送家庭群聊消息' })
  async createMessage(
    @Body() dto: CreateFamilyChatMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.familyService.createChatMessage(dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除家庭群聊消息' })
  async deleteMessage(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.familyService.deleteChatMessage(id, user);
  }
}
