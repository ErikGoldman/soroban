export interface UserIdentity {
  id: string;
  email: string;
}

const stubUser: UserIdentity = {
  id: "user-demo-001",
  email: "demo@soroban.local",
};

export class StubAuthService {
  async getCurrentUser(): Promise<UserIdentity> {
    return stubUser;
  }
}
