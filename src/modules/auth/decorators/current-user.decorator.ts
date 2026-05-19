import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * 获取当前登录用户
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
