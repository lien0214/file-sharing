import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Optional JWT guard for endpoints that accept both anonymous and authenticated requests.
 * - No Authorization header → passes through with req.user = undefined.
 * - Valid token → populates req.user.
 * - Invalid/expired token → returns 401.
 */
@Injectable()
export class OptionalJwtGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const auth: string | undefined = request.headers['authorization'];

    // No token present — skip passport entirely, allow anonymous access.
    if (!auth) return true;

    return super.canActivate(context);
  }

  // Do not throw on unauthenticated — handled above.
  handleRequest(err: any, user: any) {
    if (err) throw err;
    return user ?? null;
  }
}
