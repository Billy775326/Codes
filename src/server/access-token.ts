import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '../shared/errors.js';
import {
  accessTokenLimits,
  validNewAccessToken,
  type AccessTokenSource,
} from '../shared/access-token.js';
import { writePrivateFile } from './settings-file.js';

const digest = (token: string) => createHash('sha256').update(token).digest();

export class AccessToken {
  readonly source: AccessTokenSource;
  readonly file: string;
  private active: Buffer;

  constructor(directory: string, environmentToken?: string) {
    this.file = join(directory, 'access-token');
    if (!existsSync(this.file))
      writeFileSync(this.file, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
    const value = environmentToken ?? readFileSync(this.file, 'utf8').trim();
    if (value.length < accessTokenLimits.min)
      throw new Error('The workspace access token must contain at least 16 characters.');
    this.source = environmentToken === undefined ? 'file' : 'environment';
    this.active = digest(value);
  }

  matches(value: string) {
    return timingSafeEqual(this.active, digest(value));
  }

  replace(value: string) {
    if (this.source === 'environment')
      throw new AppError('TOKEN_MANAGED', 'The server environment manages the access token.', 409);
    if (!validNewAccessToken(value))
      throw new AppError(
        'TOKEN_INVALID',
        'Use 16–256 characters without surrounding whitespace or control characters.',
      );
    if (this.matches(value))
      throw new AppError('TOKEN_UNCHANGED', 'Choose a different access token.');
    writePrivateFile(this.file, value + '\n');
    this.active = digest(value);
  }
}
