import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';

/**
 * Global HTTP logging interceptor.
 * Logs every request as: [METHOD] /path → STATUS in Xms
 * Warnings are emitted for 4xx/5xx responses.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const { method, url } = req;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse<Response>();
          const ms = Date.now() - start;
          this.logger.log(`${method} ${url} → ${res.statusCode} [${ms}ms]`);
        },
        error: (err: { status?: number; message?: string }) => {
          const status = err?.status ?? 500;
          const ms = Date.now() - start;
          const msg = err?.message ?? 'Unknown error';
          if (status >= 500) {
            this.logger.error(`${method} ${url} → ${status} [${ms}ms] ${msg}`);
          } else {
            this.logger.warn(`${method} ${url} → ${status} [${ms}ms] ${msg}`);
          }
        },
      }),
    );
  }
}
