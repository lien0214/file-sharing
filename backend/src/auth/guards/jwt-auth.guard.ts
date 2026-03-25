import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Requires a valid user JWT. Returns 401 if missing or invalid. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
