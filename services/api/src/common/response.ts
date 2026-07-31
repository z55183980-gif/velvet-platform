export interface ApiResult<T> {
  code: number;
  message: string;
  data: T | null;
}

export function ok<T>(data: T | null = null, message = 'ok'): ApiResult<T> {
  return { code: 0, message, data };
}
