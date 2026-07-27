export interface UserLoggedInEvent {
  userId: string;
  email: string;
}

export interface UserCreatedEvent {
  userId: string;
  role: string;
  organizationId: string;
}

export interface UserDeletedEvent {
  userId: string;
}
