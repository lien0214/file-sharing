import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Extracts `req.user` (populated by JwtStrategy) from the request. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
