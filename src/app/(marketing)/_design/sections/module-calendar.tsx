/**
 * Generated from the Alisio PMS design export by scripts/port-design.mjs.
 * Hand edits here are lost on the next run — change the design source instead.
 */
import Link from 'next/link';

export default function SectionModuleCalendar() {
  return (
    <>
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "80px 28px 0" }}>
        <Link href="/product" data-route="product" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11.5px", letterSpacing: ".16em" }}>← ALL MODULES</Link>
        <h1 style={{ marginTop: "20px", fontSize: "clamp(36px,5vw,62px)", lineHeight: "1.03", letterSpacing: "-.036em", fontWeight: "600", maxWidth: "20ch" }}>Calendar &amp; Bookings</h1>
        <p style={{ marginTop: "20px", fontSize: "19px", lineHeight: "1.6", color: "#9BA3AB", maxWidth: "60ch" }}>
          The screen your reception lives in. One tape for rooms, domes, saunas, tubs, parking bays and equipment, because in Alisio all of them are simply resources with a calendar.
        </p>
        <div style={{ marginTop: "26px", display: "flex", gap: "10px", flexWrap: "wrap", fontSize: "13.5px" }}>
          <span style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: "99px", padding: "7px 14px", color: "#B6BCC3" }}>Drag &amp; drop</span>
          <span style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: "99px", padding: "7px 14px", color: "#B6BCC3" }}>Group bookings</span>
          <span style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: "99px", padding: "7px 14px", color: "#B6BCC3" }}>Offline-first</span>
          <span style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: "99px", padding: "7px 14px", color: "#B6BCC3" }}>Audit log</span>
        </div>
      </div>
      <div style={{ maxWidth: "1280px", margin: "48px auto 0", padding: "0 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "28px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "20px", fontWeight: "600" }}>One gesture, five consequences</h3>
            <p style={{ marginTop: "10px", fontSize: "15.5px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Drag a stay into another unit: the rate recalculates against that unit's plan, channels resync, housekeeping reorders its route, the folio adjusts, and the move lands in the audit log with your name on it.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .06s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "28px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "20px", fontWeight: "600" }}>Groups without a spreadsheet</h3>
            <p style={{ marginTop: "10px", fontSize: "15.5px", lineHeight: "1.6", color: "#9BA3AB" }}>
              A group is one contract, one balance and one allocation board. Rooming lists arrive as a paste, deposits are tracked per milestone, and the exposure shows up in the owner's briefing while there is still time to react.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .12s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "28px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "20px", fontWeight: "600" }}>Statuses that mean something</h3>
            <p style={{ marginTop: "10px", fontSize: "15.5px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Confirmed, in-house, departed, awaiting payment, blocked for maintenance. A colour is never decoration, awaiting-payment bars are what the Money agent works from at 06:00.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .18s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "28px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "20px", fontWeight: "600" }}>It works when the internet does not</h3>
            <p style={{ marginTop: "10px", fontSize: "15.5px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Reception is offline-first. Check a guest in during an outage; the event queue syncs when the line comes back, in the order things actually happened.
            </p>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: "1280px", margin: "80px auto 0", padding: "0 28px 120px" }}>
        <div style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: "20px", padding: "44px", display: "flex", gap: "28px", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", background: "#0B0E11" }}>
          <div>
            <h2 style={{ fontSize: "26px", fontWeight: "600", letterSpacing: "-.02em" }}>Want the tape with your own units in it?</h2>
            <p style={{ marginTop: "8px", fontSize: "16px", color: "#9BA3AB" }}>
              We load your unit list before the call, so the demo is your property, not ours.
            </p>
          </div>
          <Link href="/demo" data-route="demo" style={{ background: "var(--acc,#3DDCC0)", color: "#07100E", fontWeight: "600", fontSize: "16px", padding: "15px 26px", borderRadius: "12px" }}>Book a demo</Link>
        </div>
      </div>
    </>
  );
}
