import { Injectable, Logger } from '@nestjs/common';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StructuredLogFields {
  event: string;
  [k: string]: unknown;
}

/**
 * 结构化日志服务：JSON 行输出，便于 ELK / Datadog / Loki 索引。
 * 调用方传 `event` 与业务字段，框架补 `level / time`。
 */
@Injectable()
export class StructuredLogger {
  private readonly logger = new Logger('app');

  log(fields: StructuredLogFields) {
    this.write('info', fields);
  }
  warn(fields: StructuredLogFields) {
    this.write('warn', fields);
  }
  error(fields: StructuredLogFields) {
    this.write('error', fields);
  }
  debug(fields: StructuredLogFields) {
    this.write('debug', fields);
  }

  private write(level: LogLevel, fields: StructuredLogFields) {
    const payload = {
      level,
      time: new Date().toISOString(),
      ...fields,
    };
    const line = JSON.stringify(payload, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    if (level === 'error') this.logger.error(line);
    else if (level === 'warn') this.logger.warn(line);
    else if (level === 'debug') this.logger.debug(line);
    else this.logger.log(line);
  }
}