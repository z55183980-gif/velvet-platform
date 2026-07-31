import { Injectable } from '@nestjs/common';
import { JwtService } from '../common/jwt.service';

export interface SessionPayload {
  userId: string;
  phone?: string;
  locale: string;
  sessionId: string;
}

@Injectable()
export class SessionService {
  constructor(private readonly jwt: JwtService) {}

  sign(payload: SessionPayload): string {
    return this.jwt.sign(payload);
  }

  verify(token: string): SessionPayload | null {
    return this.jwt.verify(token);
  }
}
