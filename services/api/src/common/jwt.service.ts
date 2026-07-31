import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtService {
  private readonly secret: string;
  private readonly expiresIn: string;

  constructor(private readonly config: ConfigService) {
    this.secret = this.config.get<string>('JWT_SECRET') || 'dev-secret';
    this.expiresIn = this.config.get<string>('JWT_EXPIRES_IN') || '30d';
  }

  sign(payload: object): string {
    return jwt.sign(payload, this.secret, { expiresIn: this.expiresIn as any });
  }

  verify<T = any>(token: string): T | null {
    try {
      return jwt.verify(token, this.secret) as T;
    } catch {
      return null;
    }
  }
}
