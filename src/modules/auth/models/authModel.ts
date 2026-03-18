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
  studentId: string;
  carnet: string;
  email: string;
  fullName: string;
  role: 'voter' | 'admin';
}

export interface AuthResponse {
  token: string;
  user: {
    studentId: string;
    carnet: string;
    fullName: string;
    email: string;
    role: string;
    sede: string;
    career: string;
  };
}
