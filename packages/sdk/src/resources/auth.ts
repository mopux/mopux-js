import type { ApiToken, AuthenticatedUser, AuthTokenData } from '../types.js';
import * as v from '../validate.js';
import { Resource } from './resource.js';

export class AuthTokens extends Resource {
  /** API tokens of the authenticated user (never their secrets); `current` marks the one in use. */
  async list(): Promise<ApiToken[]> {
    const response = await this.connector.get('auth/tokens');
    return (response.data ?? []) as ApiToken[];
  }

  /** Revokes an API token of the authenticated user. Revoking the current one logs out. */
  async delete(tokenId: number): Promise<void> {
    await this.connector.delete(`auth/tokens/${v.id(tokenId, 'tokenId')}`);
  }
}

export class Auth extends Resource {
  readonly tokens = new AuthTokens(this.connector);

  /** Exchanges email and password for a new personal token. Each login creates a token. */
  async login(email: string, password: string, tokenName?: string): Promise<AuthTokenData> {
    const response = await this.connector.post('auth/login', {
      email: v.text(email, 'email'),
      password,
      ...(tokenName === undefined ? {} : { token_name: v.text(tokenName, 'tokenName', 255) }),
    });
    return response.data as AuthTokenData;
  }

  /** Revokes the token used for the request. */
  async logout(): Promise<void> {
    await this.connector.post('auth/logout');
  }

  /** The user the token belongs to. */
  async user(): Promise<AuthenticatedUser> {
    const response = await this.connector.get('auth/user');
    return (response.data as { user: AuthenticatedUser }).user;
  }
}
