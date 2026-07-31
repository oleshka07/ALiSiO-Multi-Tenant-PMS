/**
 * Generated from the Alisio PMS design export by scripts/port-design.mjs.
 * Hand edits here are lost on the next run — change the design source instead.
 */
import Link from 'next/link';

export default function SectionModuleHousekeeping() {
  return (
    <>
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "80px 28px 0" }}>
        <Link href="/product" data-route="product" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11.5px", letterSpacing: ".16em" }}>← ALL MODULES</Link>
        <h1 style={{ marginTop: "20px", fontSize: "clamp(36px,5vw,62px)", lineHeight: "1.03", letterSpacing: "-.036em", fontWeight: "600", maxWidth: "22ch" }}>Housekeeping, maintenance and tasks</h1>
        <p style={{ marginTop: "20px", fontSize: "19px", lineHeight: "1.6", color: "#9BA3AB", maxWidth: "62ch" }}>
          Line staff do not want a dashboard. They want to know which unit is next, what is different about it, and how to say it is finished. That is one card, in their language, with gloves on.
        </p>
      </div>
      <div style={{ maxWidth: "1280px", margin: "48px auto 0", padding: "0 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "28px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "20px", fontWeight: "600" }}>Routes ordered by arrival, not by number</h3>
            <p style={{ marginTop: "10px", fontSize: "15.5px", lineHeight: "1.6", color: "#9BA3AB" }}>
              The Housekeeping agent re-sequences the round whenever an early arrival or a late departure lands, and tells the person on shift, not the manager, who would then have to tell them.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .06s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "28px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "20px", fontWeight: "600" }}>Photo is the proof</h3>
            <p style={{ marginTop: "10px", fontSize: "15.5px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Completion carries a timestamp and an image. Spot-check inspection compares against the standard, and disputes about whether a unit was ready stop being a memory contest.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .12s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "28px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "20px", fontWeight: "600" }}>Minutes become money</h3>
            <p style={{ marginTop: "10px", fontSize: "15.5px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Actual cleaning minutes × shift rate flow straight into the unit-night P&amp;L. This is why a cheap single-night booking on a heavy unit shows up as a loss instead of a win.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .18s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "28px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "20px", fontWeight: "600" }}>Maintenance that predicts</h3>
            <p style={{ marginTop: "10px", fontSize: "15.5px", lineHeight: "1.6", color: "#9BA3AB" }}>
              When cleaning time on one unit drifts upward for three weeks, something is broken. The system raises it with an estimate and a contractor slot before the guest writes the review.
            </p>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: "1280px", margin: "80px auto 0", padding: "0 28px 120px" }}>
        <div style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: "20px", padding: "44px", display: "flex", gap: "28px", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", background: "#0B0E11" }}>
          <div>
            <h2 style={{ fontSize: "26px", fontWeight: "600", letterSpacing: "-.02em" }}>Works over Telegram for staff without accounts</h2>
            <p style={{ marginTop: "8px", fontSize: "16px", color: "#9BA3AB" }}>
              Seasonal teams get their tasks where they already are. No onboarding, no licences per person.
            </p>
          </div>
          <Link href="/integrations" data-route="integrations" style={{ border: "1px solid rgba(255,255,255,.18)", color: "#ECEAE5", fontWeight: "500", fontSize: "16px", padding: "15px 26px", borderRadius: "12px" }}>See integrations</Link>
        </div>
      </div>
    </>
  );
}
