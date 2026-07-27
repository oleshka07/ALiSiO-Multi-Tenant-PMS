export interface LeadCreatedEvent {
  leadId: string;
  source: string;
  stage: string;
  email?: string;
  organizationId: string;
}

export interface LeadStageChangedEvent {
  leadId: string;
  fromStage: string;
  toStage: string;
  changedBy: string;
}

export interface LeadDeletedEvent {
  leadId: string;
}

export interface CrmMessageSentEvent {
  messageId: string;
  conversationId: string;
  leadId: string;
  channel: string;
  direction: 'inbound' | 'outbound';
}
