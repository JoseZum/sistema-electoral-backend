export interface MicrosoftIdTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  email?: string;
  preferred_username?: string;
  name?: string;
  oid?: string;
  tid?: string;
}

export interface SessionJWTPayload {
  carnet: string;
  email: string;
  fullName: string;
  role: 'voter' | 'tee_member' | 'president' | 'dev_admin';
  teeMemberId?: string;
}

export interface AuthResponse {
  token: string;
  user: {
    carnet: string;
    fullName: string;
    email: string;
    role: string;
    sede: string;
    career: string;
  };
}
