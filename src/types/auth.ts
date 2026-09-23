export interface AuthUser {
  id: string;
  email: string;
  username: string;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}
