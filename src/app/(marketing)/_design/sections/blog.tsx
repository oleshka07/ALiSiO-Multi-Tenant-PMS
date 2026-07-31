/**
 * Generated from the Alisio PMS design export by scripts/port-design.mjs.
 * Hand edits here are lost on the next run — change the design source instead.
 */
import Link from 'next/link';

export default function SectionBlog() {
  return (
    <>
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "80px 28px 0" }}>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11.5px", letterSpacing: ".16em", color: "var(--acc,#3DDCC0)" }}>THE JOURNAL</div>
        <h1 style={{ marginTop: "18px", fontSize: "clamp(38px,5.4vw,66px)", lineHeight: "1.02", letterSpacing: "-.036em", fontWeight: "600", maxWidth: "19ch" }}>Operating notes for people who run properties.</h1>
        <p style={{ marginTop: "22px", fontSize: "19px", lineHeight: "1.6", color: "#9BA3AB", maxWidth: "60ch" }}>
          Revenue mechanics, compliance in Central Europe, and what it actually takes to let software make decisions in a hotel. No thought leadership.
        </p>
        <div style={{ marginTop: "28px", display: "flex", gap: "8px", flexWrap: "wrap", fontSize: "13.5px" }}>
          <span style={{ background: "var(--acc,#3DDCC0)", color: "#07100E", fontWeight: "600", borderRadius: "99px", padding: "8px 15px" }}>All</span>
          <span style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: "99px", padding: "8px 15px", color: "#B6BCC3" }}>Revenue</span>
          <span style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: "99px", padding: "8px 15px", color: "#B6BCC3" }}>AI operations</span>
          <span style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: "99px", padding: "8px 15px", color: "#B6BCC3" }}>Compliance</span>
          <span style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: "99px", padding: "8px 15px", color: "#B6BCC3" }}>Glamping</span>
          <span style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: "99px", padding: "8px 15px", color: "#B6BCC3" }}>Operations</span>
        </div>
      </div>
      <div style={{ maxWidth: "1280px", margin: "44px auto 0", padding: "0 28px" }}>
        <Link href="/blog/goppar-uplift" data-route="post-goppar" data-reveal={true} style={{ opacity: "0", transform: "translateY(20px)", transition: "all .8s ease", display: "grid", gridTemplateColumns: "1.05fr .95fr", gap: "0", border: "1px solid rgba(255,255,255,.12)", borderRadius: "22px", overflow: "hidden", background: "#0C1013", color: "#ECEAE5" }} className="dcx-h8">
          <div style={{ padding: "44px" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "var(--acc,#3DDCC0)", letterSpacing: ".12em" }}>FEATURED · REVENUE · 9 MIN</div>
            <h2 style={{ marginTop: "14px", fontSize: "34px", fontWeight: "600", lineHeight: "1.12", letterSpacing: "-.028em" }}>The booking that costs you money: unit-night GOP explained</h2>
            <p style={{ marginTop: "14px", fontSize: "16.5px", lineHeight: "1.65", color: "#9BA3AB" }}>
              Occupancy is vanity, ADR is comfort, and RevPAR still hides the cleaning. Here is how to subtract the real cost of a night, and why single Monday stays from one particular channel are almost always negative.
            </p>
            <div style={{ marginTop: "20px", fontSize: "14px", color: "#6F787F" }}>28 July 2026 · Alisio revenue team</div>
          </div>
          <div style={{ minHeight: "300px", background: "radial-gradient(120% 140% at 20% 10%,rgba(61,220,192,.5),transparent 55%),radial-gradient(100% 120% at 85% 80%,rgba(96,120,255,.45),transparent 60%),#0F1418" }} />
        </Link>
      </div>
      <div style={{ maxWidth: "1280px", margin: "20px auto 0", padding: "0 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "16px" }}>
          <Link href="/blog/autonomy-levels" data-route="post-autonomy" data-reveal={true} style={{ opacity: "0", transform: "translateY(18px)", transition: "all .6s ease", display: "block", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", overflow: "hidden", background: "#0C1013", color: "#ECEAE5" }} className="dcx-h6">
            <div style={{ height: "150px", background: "radial-gradient(120% 140% at 80% 15%,rgba(242,180,90,.45),transparent 55%),radial-gradient(110% 130% at 10% 85%,rgba(61,220,192,.4),transparent 60%),#0F1418" }} />
            <div style={{ padding: "24px" }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E", letterSpacing: ".1em" }}>AI OPERATIONS · 12 MIN</div>
              <h3 style={{ fontSize: "19px", fontWeight: "600", marginTop: "10px", lineHeight: "1.3", letterSpacing: "-.02em" }}>Six levels of trust: how to let software price your rooms</h3>
              <p style={{ marginTop: "9px", fontSize: "14.5px", color: "#8B939C", lineHeight: "1.55" }}>
                A practical ladder from observer to owner of the KPI, and the guardrails that make each rung safe.
              </p>
            </div>
          </Link>
          <Link href="/blog" data-route="blog" data-reveal={true} style={{ opacity: "0", transform: "translateY(18px)", transition: "all .6s ease .05s", display: "block", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", overflow: "hidden", background: "#0C1013", color: "#ECEAE5" }} className="dcx-h6">
            <div style={{ height: "150px", background: "radial-gradient(130% 150% at 50% 0%,rgba(120,200,255,.42),transparent 58%),radial-gradient(90% 110% at 90% 90%,rgba(255,107,90,.3),transparent 60%),#0F1418" }} />
            <div style={{ padding: "24px" }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E", letterSpacing: ".1em" }}>COMPLIANCE · 7 MIN</div>
              <h3 style={{ fontSize: "19px", fontWeight: "600", marginTop: "10px", lineHeight: "1.3", letterSpacing: "-.02em" }}>Foreign guest registration in CZ, SK and PL without Sunday evenings</h3>
              <p style={{ marginTop: "9px", fontSize: "14.5px", color: "#8B939C", lineHeight: "1.55" }}>What the statutory windows actually are, and what to automate first.</p>
            </div>
          </Link>
          <Link href="/blog" data-route="blog" data-reveal={true} style={{ opacity: "0", transform: "translateY(18px)", transition: "all .6s ease .1s", display: "block", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", overflow: "hidden", background: "#0C1013", color: "#ECEAE5" }} className="dcx-h6">
            <div style={{ height: "150px", background: "radial-gradient(120% 140% at 25% 20%,rgba(61,220,192,.4),transparent 55%),radial-gradient(110% 120% at 90% 70%,rgba(242,180,90,.35),transparent 60%),#0F1418" }} />
            <div style={{ padding: "24px" }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E", letterSpacing: ".1em" }}>GLAMPING · 8 MIN</div>
              <h3 style={{ fontSize: "19px", fontWeight: "600", marginTop: "10px", lineHeight: "1.3", letterSpacing: "-.02em" }}>Sixty sellable resources from eighteen units, with no capex</h3>
              <p style={{ marginTop: "9px", fontSize: "14.5px", color: "#8B939C", lineHeight: "1.55" }}>Tubs, saunas, firewood, EV bays, boats and gear as first-class inventory.</p>
            </div>
          </Link>
          <Link href="/blog" data-route="blog" style={{ display: "block", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "24px", background: "#0C1013", color: "#ECEAE5" }} className="dcx-h6">
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E", letterSpacing: ".1em" }}>OPERATIONS · 6 MIN</div>
            <h3 style={{ fontSize: "18px", fontWeight: "600", marginTop: "10px", lineHeight: "1.32", letterSpacing: "-.02em" }}>Why overbooking is an architecture problem, not a discipline problem</h3>
          </Link>
          <Link href="/blog" data-route="blog" style={{ display: "block", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "24px", background: "#0C1013", color: "#ECEAE5" }} className="dcx-h6">
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E", letterSpacing: ".1em" }}>REVENUE · 7 MIN</div>
            <h3 style={{ fontSize: "18px", fontWeight: "600", marginTop: "10px", lineHeight: "1.32", letterSpacing: "-.02em" }}>Orphan nights: the quietest loss in a small property</h3>
          </Link>
          <Link href="/blog" data-route="blog" style={{ display: "block", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "24px", background: "#0C1013", color: "#ECEAE5" }} className="dcx-h6">
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E", letterSpacing: ".1em" }}>AI OPERATIONS · 10 MIN</div>
            <h3 style={{ fontSize: "18px", fontWeight: "600", marginTop: "10px", lineHeight: "1.32", letterSpacing: "-.02em" }}>Holdout baselines: how to prove an AI actually earned the money</h3>
          </Link>
          <Link href="/blog" data-route="blog" style={{ display: "block", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "24px", background: "#0C1013", color: "#ECEAE5" }} className="dcx-h6">
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E", letterSpacing: ".1em" }}>OPERATIONS · 5 MIN</div>
            <h3 style={{ fontSize: "18px", fontWeight: "600", marginTop: "10px", lineHeight: "1.32", letterSpacing: "-.02em" }}>Cleaning minutes are a revenue metric. Start measuring them.</h3>
          </Link>
          <Link href="/blog" data-route="blog" style={{ display: "block", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "24px", background: "#0C1013", color: "#ECEAE5" }} className="dcx-h6">
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E", letterSpacing: ".1em" }}>COMPLIANCE · 9 MIN</div>
            <h3 style={{ fontSize: "18px", fontWeight: "600", marginTop: "10px", lineHeight: "1.32", letterSpacing: "-.02em" }}>The EU AI Act in a hotel: what you must tell your guests</h3>
          </Link>
          <Link href="/blog" data-route="blog" style={{ display: "block", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "24px", background: "#0C1013", color: "#ECEAE5" }} className="dcx-h6">
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E", letterSpacing: ".1em" }}>DISTRIBUTION · 8 MIN</div>
            <h3 style={{ fontSize: "18px", fontWeight: "600", marginTop: "10px", lineHeight: "1.32", letterSpacing: "-.02em" }}>True cost per channel: commission is only the first line</h3>
          </Link>
          <Link href="/blog" data-route="blog" style={{ display: "block", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "24px", background: "#0C1013", color: "#ECEAE5" }} className="dcx-h6">
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E", letterSpacing: ".1em" }}>GUEST · 6 MIN</div>
            <h3 style={{ fontSize: "18px", fontWeight: "600", marginTop: "10px", lineHeight: "1.32", letterSpacing: "-.02em" }}>Self check-in without losing the welcome</h3>
          </Link>
          <Link href="/blog" data-route="blog" style={{ display: "block", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "24px", background: "#0C1013", color: "#ECEAE5" }} className="dcx-h6">
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E", letterSpacing: ".1em" }}>FINANCE · 11 MIN</div>
            <h3 style={{ fontSize: "18px", fontWeight: "600", marginTop: "10px", lineHeight: "1.32", letterSpacing: "-.02em" }}>Thirteen weeks of cash flow for a seasonal property</h3>
          </Link>
          <Link href="/blog" data-route="blog" style={{ display: "block", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "24px", background: "#0C1013", color: "#ECEAE5" }} className="dcx-h6">
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E", letterSpacing: ".1em" }}>STRATEGY · 9 MIN</div>
            <h3 style={{ fontSize: "18px", fontWeight: "600", marginTop: "10px", lineHeight: "1.32", letterSpacing: "-.02em" }}>Guests will book through AI assistants. Can yours be found?</h3>
          </Link>
          <Link href="/blog" data-route="blog" style={{ display: "block", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "24px", background: "#0C1013", color: "#ECEAE5" }} className="dcx-h6">
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E", letterSpacing: ".1em" }}>OPERATIONS · 7 MIN</div>
            <h3 style={{ fontSize: "18px", fontWeight: "600", marginTop: "10px", lineHeight: "1.32", letterSpacing: "-.02em" }}>Migrating a property system in season without losing a booking</h3>
          </Link>
        </div>
      </div>
      <div style={{ maxWidth: "1280px", margin: "80px auto 0", padding: "0 28px 120px" }}>
        <div style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: "20px", padding: "44px", display: "flex", gap: "28px", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", background: "#0B0E11" }}>
          <div>
            <h2 style={{ fontSize: "26px", fontWeight: "600", letterSpacing: "-.02em" }}>One operating note a fortnight</h2>
            <p style={{ marginTop: "8px", fontSize: "16px", color: "#9BA3AB" }}>Written for owners and managers. No product announcements.</p>
          </div>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <span style={{ border: "1px solid rgba(255,255,255,.14)", borderRadius: "11px", padding: "14px 18px", color: "#6F787F", fontSize: "15px", minWidth: "240px" }}>you@property.com</span>
            <span style={{ background: "var(--acc,#3DDCC0)", color: "#07100E", fontWeight: "600", fontSize: "15.5px", padding: "14px 22px", borderRadius: "11px" }}>Subscribe</span>
          </div>
        </div>
      </div>
    </>
  );
}
