import { NextResponse } from 'next/server';
import { sendEmail } from '@/lib/channels/email'; // TODO: replace with eventBus

export async function testEmail() {
  try {
    const user = process.env.EMAIL_CZ_USER;
    if (!user) {
      return NextResponse.json({ error: 'EMAIL_CZ_USER not configured' }, { status: 500 });
    }

    const result = await sendEmail({
      to: user,
      subject: `ALiSiO CRM — Email Test (${new Date().toLocaleTimeString('cs-CZ')})`,
      text: 'Toto je testovací email z ALiSiO CRM. Pokud ho vidíte, integrace funguje správně! ✅',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2 style="color: #6366f1;">✅ ALiSiO CRM — Email Test</h2>
          <p>Toto je testovací email z ALiSiO CRM.</p>
          <p>Pokud ho vidíte, integrace funguje správně!</p>
          <p style="color: #888; font-size: 12px;">Sent at: ${new Date().toISOString()}</p>
        </div>
      `,
    });

    return NextResponse.json({
      success: result.success,
      messageId: result.messageId,
      sentTo: user,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Email Test]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
