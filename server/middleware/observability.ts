import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function requestObservability(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const requestId = incoming && /^[a-zA-Z0-9._:-]{8,128}$/.test(incoming) ? incoming : randomUUID();
  const startedAt = Date.now();
  res.setHeader('X-Request-Id', requestId);

  res.on('finish', () => {
    const record = {
      type: 'http_request',
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      environment: process.env.VEYRA_ENV ?? 'local',
      ts: new Date().toISOString(),
    };
    console.log(JSON.stringify(record));
  });
  next();
}
