/**
 * Generated from the Alisio PMS design export by scripts/port-design.mjs.
 * Hand edits here are lost on the next run — change the design source instead.
 */
import Link from 'next/link';

export default function SectionModuleGuestPortal() {
  return (
    <>
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "80px 28px 0" }}>
        <Link href="/product" data-route="product" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11.5px", letterSpacing: ".16em" }}>← ALL MODULES</Link>
        <h1 style={{ marginTop: "20px", fontSize: "clamp(36px,5vw,62px)", lineHeight: "1.03", letterSpacing: "-.036em", fontWeight: "600", maxWidth: "20ch" }}>Guest Portal</h1>
        <p style={{ marginTop: "20px", fontSize: "19px", lineHeight: "1.6", color: "#9BA3AB", maxWidth: "60ch" }}>
          One secure link per stay. No app, no password, no download. Everything the guest needs to do before arrival, and everything you want to sell them once they are on site.
        </p>
      </div>
      <div style={{ maxWidth: "1280px", margin: "48px auto 0", padding: "0 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "28px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "20px", fontWeight: "600" }}>Check-in the guest does themselves</h3>
            <p style={{ marginTop: "10px", fontSize: "15.5px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Passport or ID photographed and parsed, guest data validated against what the registration form requires, house rules signed digitally with a timestamped record. Reception confirms rather than types.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .06s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "28px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "20px", fontWeight: "600" }}>Balance paid before the door opens</h3>
            <p style={{ marginTop: "10px", fontSize: "15.5px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Card, Apple Pay or Google Pay against the live folio, with pre-authorised deposits released automatically on departure. Failed cards are retried by the Money agent, not chased by a person.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .12s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "28px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "20px", fontWeight: "600" }}>In-stay services that actually sell</h3>
            <p style={{ marginTop: "10px", fontSize: "15.5px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Hot tub slots, sauna sessions, breakfast, late checkout, transfers and firewood, offered at the moment the Upsell agent judges best, with live availability from the same calendar the tape uses.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .18s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "28px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "20px", fontWeight: "600" }}>After the stay</h3>
            <p style={{ marginTop: "10px", fontSize: "15.5px", lineHeight: "1.6", color: "#9BA3AB" }}>
              NPS asked at the right hour, happy guests routed to the review platform that matters to you, unhappy ones routed to a human with the full stay context already attached.
            </p>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: "1280px", margin: "80px auto 0", padding: "0 28px 120px" }}>
        <div style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: "20px", padding: "44px", display: "flex", gap: "28px", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", background: "#0B0E11" }}>
          <div>
            <h2 style={{ fontSize: "26px", fontWeight: "600", letterSpacing: "-.02em" }}>Branded to your property, not to us</h2>
            <p style={{ marginTop: "8px", fontSize: "16px", color: "#9BA3AB" }}>
              Your logo, colours, domain and voice. Guests never see the word Alisio unless you want them to.
            </p>
          </div>
          <Link href="/demo" data-route="demo" style={{ background: "var(--acc,#3DDCC0)", color: "#07100E", fontWeight: "600", fontSize: "16px", padding: "15px 26px", borderRadius: "12px" }}>Book a demo</Link>
        </div>
      </div>
    </>
  );
}
