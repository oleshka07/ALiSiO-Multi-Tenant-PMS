/**
 * Generated from the Alisio PMS design export by scripts/port-design.mjs.
 * Hand edits here are lost on the next run — change the design source instead.
 */
import Link from 'next/link';

export default function SectionModuleChannels() {
  return (
    <>
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "80px 28px 0" }}>
        <Link href="/product" data-route="product" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11.5px", letterSpacing: ".16em" }}>← ALL MODULES</Link>
        <h1 style={{ marginTop: "20px", fontSize: "clamp(36px,5vw,62px)", lineHeight: "1.03", letterSpacing: "-.036em", fontWeight: "600", maxWidth: "20ch" }}>Channel Manager</h1>
        <p style={{ marginTop: "20px", fontSize: "19px", lineHeight: "1.6", color: "#9BA3AB", maxWidth: "60ch" }}>
          Two-way availability, rates and inventory. Not a nightly file exchange, a live queue with retries, and an invariant in the database that makes a double sale structurally impossible.
        </p>
      </div>
      <div style={{ maxWidth: "1280px", margin: "48px auto 0", padding: "0 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.1fr .9fr", gap: "28px", alignItems: "start" }}>
          <div style={{ display: "grid", gap: "16px" }}>
            <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "28px", background: "#0C1013" }}>
              <h3 style={{ fontSize: "20px", fontWeight: "600" }}>Zero overbooking is an architecture claim</h3>
              <p style={{ marginTop: "10px", fontSize: "15.5px", lineHeight: "1.6", color: "#9BA3AB" }}>
                Availability is derived from the resource graph, and the conflict check sits in the write path itself. No agent, integration or human can commit two stays into one unit-night, the transaction is rejected before it exists.
              </p>
            </div>
            <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .06s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "28px", background: "#0C1013" }}>
              <h3 style={{ fontSize: "20px", fontWeight: "600" }}>True cost per channel</h3>
              <p style={{ marginTop: "10px", fontSize: "15.5px", lineHeight: "1.6", color: "#9BA3AB" }}>
                Commission, cancellation rate, average length of stay, upsell take-up and payment failure rate, per source. The moment a channel stops paying for itself you see it as a number, not a feeling.
              </p>
            </div>
            <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .12s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "28px", background: "#0C1013" }}>
              <h3 style={{ fontSize: "20px", fontWeight: "600" }}>Mapping and parity health</h3>
              <p style={{ marginTop: "10px", fontSize: "15.5px", lineHeight: "1.6", color: "#9BA3AB" }}>
                Unmapped units, stale listings, rate-plan mismatches and parity gaps are surfaced as tasks with a one-click fix, and the Channel agent closes most of them before anyone opens the module.
              </p>
            </div>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .08s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", background: "#0D1114", padding: "20px" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E", letterSpacing: ".1em", marginBottom: "14px" }}>SYNC QUEUE · LIVE</div>
            <div style={{ display: "grid", gap: "9px", fontSize: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px", border: "1px solid rgba(61,220,192,.28)", background: "rgba(61,220,192,.05)", borderRadius: "11px" }}>
                <span>Booking.com · ARI push</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "12px", color: "var(--acc,#3DDCC0)" }}>2s</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px", border: "1px solid rgba(255,255,255,.1)", borderRadius: "11px" }}>
                <span>Airbnb · rates 14 dates</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "12px", color: "var(--acc,#3DDCC0)" }}>9s</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px", border: "1px solid rgba(255,255,255,.1)", borderRadius: "11px" }}>
                <span>Expedia · reservation in</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "12px", color: "var(--acc,#3DDCC0)" }}>31s</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px", border: "1px solid rgba(242,180,90,.34)", background: "rgba(242,180,90,.05)", borderRadius: "11px" }}>
                <span>Hostex · retry 1/3</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "12px", color: "#F2B45A" }}>auto</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px", border: "1px solid rgba(255,255,255,.1)", borderRadius: "11px" }}>
                <span>iCal · 6 endpoints</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "12px", color: "#8B939C" }}>4m</span>
              </div>
            </div>
            <div style={{ marginTop: "16px", padding: "14px", borderRadius: "11px", background: "rgba(255,255,255,.03)", fontSize: "13.5px", color: "#8B939C", lineHeight: "1.55" }}>
              Overbookings in the last 214 days:
              <span style={{ color: "var(--acc,#3DDCC0)" }}>0</span>
              . Failed syncs auto-resolved: 98.4%. The rest arrive as a task with the exact payload attached.
            </div>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: "1280px", margin: "80px auto 0", padding: "0 28px 120px" }}>
        <div style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: "20px", padding: "44px", display: "flex", gap: "28px", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", background: "#0B0E11" }}>
          <div>
            <h2 style={{ fontSize: "26px", fontWeight: "600", letterSpacing: "-.02em" }}>Already on a channel manager you like?</h2>
            <p style={{ marginTop: "8px", fontSize: "16px", color: "#9BA3AB" }}>Keep it. Alisio can run beside it read-only for the first fourteen days.</p>
          </div>
          <Link href="/integrations" data-route="integrations" style={{ border: "1px solid rgba(255,255,255,.18)", color: "#ECEAE5", fontWeight: "500", fontSize: "16px", padding: "15px 26px", borderRadius: "12px" }}>See integrations</Link>
        </div>
      </div>
    </>
  );
}
