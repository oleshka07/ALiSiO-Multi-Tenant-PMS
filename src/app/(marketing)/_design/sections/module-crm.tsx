/**
 * Generated from the Alisio PMS design export by scripts/port-design.mjs.
 * Hand edits here are lost on the next run — change the design source instead.
 */
import Link from 'next/link';

export default function SectionModuleCrm() {
  return (
    <>
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "80px 28px 0" }}>
        <Link href="/product" data-route="product" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11.5px", letterSpacing: ".16em" }}>← ALL MODULES</Link>
        <h1 style={{ marginTop: "20px", fontSize: "clamp(36px,5vw,62px)", lineHeight: "1.03", letterSpacing: "-.036em", fontWeight: "600", maxWidth: "22ch" }}>CRM, unified inbox and the AI that answers</h1>
        <p style={{ marginTop: "20px", fontSize: "19px", lineHeight: "1.6", color: "#9BA3AB", maxWidth: "62ch" }}>
          Telegram, e-mail, website chat and OTA messages arrive in one thread per guest, resolved to a single identity across channels, with the whole stay history beside it. Most answers are drafted or sent before your reception opens the tab.
        </p>
      </div>
      <div style={{ maxWidth: "1280px", margin: "48px auto 0", padding: "0 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "28px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "20px", fontWeight: "600" }}>Twelve languages, one voice</h3>
            <p style={{ marginTop: "10px", fontSize: "15.5px", lineHeight: "1.6", color: "#9BA3AB" }}>
              The Inbox agent replies in the guest's language using a knowledge base built from your property, parking, pets, quiet hours, the road in winter, and hands over the second confidence drops or money is involved.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .06s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "28px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "20px", fontWeight: "600" }}>Pipeline for groups and corporates</h3>
            <p style={{ marginTop: "10px", fontSize: "15.5px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Kanban stages from enquiry to signed contract, with quotes, options held on the calendar, deposit milestones and automatic follow-ups when a lead goes quiet.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .12s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "28px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "20px", fontWeight: "600" }}>Guest profiles worth having</h3>
            <p style={{ marginTop: "10px", fontSize: "15.5px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Preferences, allergies, previous units, complaint history, lifetime value and channel of origin, merged automatically when the same person books under two spellings.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .18s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "28px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "20px", fontWeight: "600" }}>Campaigns to your own list</h3>
            <p style={{ marginTop: "10px", fontSize: "15.5px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Segment by unit type, season, spend or last visit and send a direct offer, the cheapest booking you will ever make, and it never carries commission.
            </p>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: "1280px", margin: "80px auto 0", padding: "0 28px 120px" }}>
        <div style={{ border: "1px solid rgba(96,140,255,.28)", borderRadius: "20px", padding: "44px", background: "linear-gradient(120deg,rgba(96,140,255,.08),transparent 60%),#0B0E11" }}>
          <h2 style={{ fontSize: "26px", fontWeight: "600", letterSpacing: "-.02em" }}>Guests are always told when the answer is automated</h2>
          <p style={{ marginTop: "10px", fontSize: "16px", color: "#9BA3AB", maxWidth: "70ch" }}>
            Transparency is not a setting we can be talked out of. Every AI-authored message is labelled, logged with its inputs, and available in the audit trail for as long as your retention policy says.
          </p>
        </div>
      </div>
    </>
  );
}
