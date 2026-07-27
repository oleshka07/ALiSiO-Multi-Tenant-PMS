/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * CRM AI Suggest Engine
 * Generates AI-powered reply drafts for CRM conversations.
 * Uses GPT-4o with full lead context (booking, messages, stage).
 */
import OpenAI from 'openai';
import { getDb } from '@/lib/db';
import { searchKnowledge, buildKnowledgeContext } from '@/lib/crm/knowledge-base';

/* ────────────────────────────────────────────────────────
   Stage-specific default prompts (fallback when no custom)
   ──────────────────────────────────────────────────────── */
const DEFAULT_STAGE_PROMPTS: Record<string, string> = {
  new: 'The guest just made initial contact. Welcome them warmly, ask about their travel dates and preferences. Be enthusiastic about the property.',
  inquiry: 'The guest is asking about availability or pricing. Provide specific information based on their dates. Mention key amenities and what makes the property special.',
  info_needed: 'We need more information from the guest to proceed. Politely ask for the missing details (dates, number of guests, preferences).',
  quote_sent: 'A price quote has been sent. Follow up gently, ask if they have any questions about the offer. Do not pressure.',
  negotiation: 'The guest is considering the offer, possibly negotiating. Be flexible but professional. Highlight value, not just price.',
  deposit_paid: 'The guest has paid a deposit. Thank them, confirm the booking details, and provide next steps (check-in info, what to bring).',
  booked: 'The booking is confirmed. Share excitement, provide practical information about the stay (directions, check-in time, amenities).',
  pre_stay: 'The guest is arriving soon. Send a warm pre-arrival message with check-in instructions, directions, and local tips.',
  check_in: 'The guest is checking in today. Welcome them, confirm room details, and offer assistance.',
  in_stay: 'The guest is currently staying. Be helpful and attentive. Ask if everything is satisfactory, offer local recommendations.',
  check_out: 'The guest is checking out. Thank them for staying, ask for feedback, mention the possibility of future visits.',
  post_stay: 'The guest has left. Send a thank-you message, ask for a review, and offer a returning guest discount or seasonal offer.',
  lost: 'The lead was lost. If re-engaging, acknowledge the previous contact and offer a new/special deal.',
  spam: 'This lead is marked as spam. Generally do not respond.',
};

/* ────────────────────────────────────────────────────────
   Context builder — gathers all relevant lead data
   ──────────────────────────────────────────────────────── */
interface LeadContext {
  lead: any;
  messages: any[];
  stageHistory: any[];
  masterPrompt: any | null;
  stagePrompt: any | null;
  propertyInfo: any;
}

function buildLeadContext(leadId: string, conversationId: string): LeadContext {
  const db = getDb();

  // Lead with all related data
  const lead = db.prepare(`
    SELECT l.*, 
      g.country as guest_country, g.date_of_birth as guest_dob,
      r.status as reservation_status, r.payment_status, r.total_price as reservation_total,
      r.nights, r.source as booking_source,
      u.name as unit_name, ut.name as unit_type_name,
      ch.channel_type, ch.name as channel_name
    FROM crm_leads l
    LEFT JOIN guests g ON g.id = l.guest_id
    LEFT JOIN reservations r ON r.id = l.reservation_id
    LEFT JOIN units u ON u.id = r.unit_id
    LEFT JOIN unit_types ut ON ut.id = u.unit_type_id
    LEFT JOIN crm_channels ch ON ch.id = l.channel_id
    WHERE l.id = ?
  `).get(leadId) as any;

  if (!lead) throw new Error(`Lead ${leadId} not found`);

  // Last 20 messages for context
  const messages = db.prepare(`
    SELECT m.direction, m.sender_type, m.sender_name, m.content, 
           m.channel_type, m.is_ai_generated, m.created_at
    FROM crm_messages m
    WHERE m.conversation_id = ?
    ORDER BY m.created_at DESC
    LIMIT 20
  `).all(conversationId) as any[];
  messages.reverse(); // chronological order

  // Stage history
  const stageHistory = db.prepare(`
    SELECT from_stage, to_stage, trigger, created_at
    FROM crm_stage_history
    WHERE lead_id = ?
    ORDER BY created_at DESC
    LIMIT 5
  `).all(leadId) as any[];

  // MASTER prompt (stage='new') — always contains all pricing & rules
  const masterPrompt = db.prepare(`
    SELECT system_prompt, context_instructions, temperature, model
    FROM crm_prompt_configs
    WHERE stage = 'new' AND is_active = 1
    ORDER BY version DESC LIMIT 1
  `).get() as any | null;

  // Stage-specific prompt (supplementary behavioral instructions)
  const stagePrompt = lead.stage !== 'new' ? db.prepare(`
    SELECT system_prompt, context_instructions, temperature, model
    FROM crm_prompt_configs
    WHERE stage = ? AND is_active = 1
    ORDER BY version DESC LIMIT 1
  `).get(lead.stage) as any | null : null;

  // Property info
  const propertyInfo = db.prepare(`
    SELECT p.name, p.city, p.country, p.check_in_time, p.check_out_time
    FROM properties p
    LIMIT 1
  `).get() as any;

  return { lead, messages, stageHistory, masterPrompt, stagePrompt, propertyInfo };
}

/* ────────────────────────────────────────────────────────
   System prompt builder
   ──────────────────────────────────────────────────────── */
function buildSystemPrompt(ctx: LeadContext): string {
  const { lead, messages, stageHistory, propertyInfo } = ctx;
  const today = new Date().toISOString().split('T')[0];

  // Detect guest language from messages (simple heuristic)
  const guestMessages = messages
    .filter(m => m.direction === 'inbound')
    .map(m => m.content)
    .join(' ');

  let languageHint = 'Detect the language of the guest from their messages and reply in the SAME language.';
  if (guestMessages) {
    // Simple language detection by character analysis
    const hasCyrillic = /[а-яА-ЯёЁіІїЇєЄґҐ]/.test(guestMessages);
    const hasCzech = /[ěščřžýáíéúůďťňÉŠČŘŽÝÁÍÚŮĎŤŇ]/.test(guestMessages);
    const hasGerman = /[äöüÄÖÜß]/.test(guestMessages);

    if (hasCyrillic) languageHint = 'The guest writes in a Slavic language (Ukrainian/Russian). Reply in the same language they used.';
    else if (hasCzech) languageHint = 'The guest writes in Czech. Reply in Czech.';
    else if (hasGerman) languageHint = 'The guest writes in German. Reply in German.';
    else languageHint = 'Reply in the same language the guest used in their messages. If unclear, use English.';
  }

  // Stage-specific instructions from DB
  const masterInstructions = ctx.masterPrompt?.system_prompt || '';
  const stageInstructions = ctx.stagePrompt?.system_prompt || DEFAULT_STAGE_PROMPTS[lead.stage] || '';
  const contextInstructions = ctx.stagePrompt?.context_instructions || ctx.masterPrompt?.context_instructions || '';

  // Build conversation history summary
  const convHistory = messages.map(m => {
    const role = m.direction === 'inbound' ? 'GUEST' : (m.is_ai_generated ? 'AI_ASSISTANT' : 'STAFF');
    return `[${m.created_at}] ${role}: ${m.content}`;
  }).join('\n');

  // Build full system prompt
  return `You are a professional hotel/resort receptionist assistant for "${propertyInfo?.name || 'ALiSiO Resort & Glamping'}".
Located in ${propertyInfo?.city || 'Luhačovice'}, ${propertyInfo?.country || 'Czech Republic'}.
Check-in time: ${propertyInfo?.check_in_time || '14:00'}, Check-out: ${propertyInfo?.check_out_time || '11:00'}.
Today's date: ${today}.

## YOUR ROLE
- You generate professional, warm, and helpful replies to guest inquiries.
- You represent the property directly — write as "we", not "they".
- Keep responses concise but complete (2-4 paragraphs max).
- Be proactive: offer relevant information before being asked.
- Never make up information about availability or pricing — use only the data provided.

## LANGUAGE RULES
${languageHint}

## CURRENT LEAD CONTEXT
- **Guest name**: ${lead.first_name} ${lead.last_name || ''}
- **Email**: ${lead.email || 'N/A'}
- **Phone**: ${lead.phone || 'N/A'}
- **Country**: ${lead.guest_country || 'Unknown'}
- **Lead stage**: ${lead.stage}
- **Priority**: ${lead.priority}
- **Source**: ${lead.source}

## BOOKING INFO
- **Check-in**: ${lead.check_in_date || 'Not specified'}
- **Check-out**: ${lead.check_out_date || 'Not specified'}
- **Adults**: ${lead.adults || 0}, **Children**: ${lead.children || 0}
- **Estimated value**: ${lead.estimated_value ? `${lead.estimated_value.toLocaleString()} ${lead.currency}` : 'Not set'}
- **Unit type preference**: ${lead.unit_type_preference || 'None'}
- **External booking ID**: ${lead.external_booking_id || 'N/A'}
${lead.reservation_id ? `
### LINKED RESERVATION
- **Status**: ${lead.reservation_status}
- **Payment**: ${lead.payment_status}
- **Total price**: ${lead.reservation_total?.toLocaleString() || 'N/A'} ${lead.currency}
- **Unit**: ${lead.unit_name || 'N/A'} (${lead.unit_type_name || ''})
- **Nights**: ${lead.nights || 'N/A'}
` : ''}
${lead.camping_vehicle_type ? `
### CAMPING INFO
- **Vehicle**: ${lead.camping_vehicle_type}
- **Tent**: ${lead.camping_tent_type || 'N/A'}
- **Electricity**: ${lead.camping_electricity ? 'Yes' : 'No'}
` : ''}

## STAGE HISTORY (recent)
${stageHistory.length > 0 ? stageHistory.map(h => `  ${h.from_stage || '—'} → ${h.to_stage} (${h.trigger}, ${h.created_at})`).join('\n') : 'No stage changes yet.'}

## PRICING & CALCULATION RULES (Master)
${masterInstructions}

${(() => {
  // Search knowledge base using last guest message
  const lastGuestMsg = messages.filter(m => m.direction === 'inbound').pop();
  if (lastGuestMsg) {
    const kbArticles = searchKnowledge(lastGuestMsg.content);
    return buildKnowledgeContext(kbArticles);
  }
  return '';
})()}

## STAGE-SPECIFIC INSTRUCTIONS (${lead.stage})
${stageInstructions}
${contextInstructions ? `\n### Additional context:\n${contextInstructions}` : ''}

## CONVERSATION HISTORY
${convHistory || 'No messages yet — this is the first contact.'}

## INSTRUCTIONS
Generate a reply to send to the guest. The reply should:
1. Be contextually appropriate for the current stage and conversation
2. Address any questions or concerns from the guest's last message
3. Be warm and professional
4. Include relevant booking/property information when helpful
5. End with a clear call-to-action or question when appropriate
6. Do NOT include salutation line like "Subject:" or "Dear..." unless it's an email format
6. Do NOT include your own signature — the staff will add it
8. If the question goes beyond available information (pricing, knowledge base) — DO NOT make up an answer. Say you will check with the administrator and get back to them.`;
}

/* ────────────────────────────────────────────────────────
   Streaming AI reply generator
   ──────────────────────────────────────────────────────── */
export async function* streamCrmSuggestion(
  leadId: string,
  conversationId: string,
  userInstruction?: string,
): AsyncGenerator<string> {
  const ctx = buildLeadContext(leadId, conversationId);
  const systemPrompt = buildSystemPrompt(ctx);

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ];

  if (userInstruction) {
    messages.push({
      role: 'user',
      content: `Additional instruction from staff: ${userInstruction}\n\nGenerate the reply now.`,
    });
  } else {
    messages.push({
      role: 'user',
      content: 'Generate the reply now.',
    });
  }

  const model = ctx.stagePrompt?.model || ctx.masterPrompt?.model || 'gpt-4o';
  const temperature = ctx.stagePrompt?.temperature ?? ctx.masterPrompt?.temperature ?? 0.7;

  const stream = await client.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: 1000,
    stream: true,
  });

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content;
    if (text) yield text;
  }
}

/* ────────────────────────────────────────────────────────
   Training data saver
   ──────────────────────────────────────────────────────── */
export function saveTrainingData(data: {
  conversationId: string;
  guestMessage: string;
  guestLanguage?: string;
  leadStage: string;
  guestContextJson?: string;
  aiDraft: string;
  finalResponse?: string;
  wasApproved: boolean;
  wasEdited: boolean;
  editReason?: string;
  rating?: number;
}) {
  const db = getDb();
  db.prepare(`
    INSERT INTO crm_ai_training 
    (conversation_id, guest_message, guest_language, lead_stage, guest_context_json,
     ai_draft, final_response, was_approved, was_edited, edit_reason, rating)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.conversationId,
    data.guestMessage,
    data.guestLanguage || null,
    data.leadStage,
    data.guestContextJson || null,
    data.aiDraft,
    data.finalResponse || null,
    data.wasApproved ? 1 : 0,
    data.wasEdited ? 1 : 0,
    data.editReason || null,
    data.rating || null,
  );
}
