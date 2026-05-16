import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class WeappBindDto {
  @ApiProperty({
    description: 'wx.login 返回的临时 code',
    example: '081234abcd',
  })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({
    description: '用户名、邮箱或手机号',
    example: 'admin',
  })
  @IsString()
  @IsNotEmpty()
  account: string;

  @ApiProperty({
    description: '密码',
    example: 'P@ssw0rd123',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}
