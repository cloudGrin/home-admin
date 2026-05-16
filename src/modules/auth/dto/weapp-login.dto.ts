import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class WeappLoginDto {
  @ApiProperty({
    description: 'wx.login 返回的临时 code',
    example: '081234abcd',
  })
  @IsString()
  @IsNotEmpty()
  code: string;
}
