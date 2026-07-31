/**
 * Generated from the Alisio PMS design export by scripts/port-design.mjs.
 * Hand edits here are lost on the next run — change the design source instead.
 */
import Link from 'next/link';

export default function SectionPostGopparUplift() {
  return (
    <>
      <div style={{ maxWidth: "820px", margin: "0 auto", padding: "80px 28px 0" }}>
        <Link href="/blog" data-route="blog" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11.5px", letterSpacing: ".16em" }}>← THE JOURNAL</Link>
        <div style={{ marginTop: "22px", fontFamily: "'JetBrains Mono',monospace", fontSize: "11.5px", letterSpacing: ".14em", color: "var(--acc,#3DDCC0)" }}>REVENUE · 9 MIN READ</div>
        <h1 style={{ marginTop: "16px", fontSize: "clamp(34px,4.6vw,54px)", lineHeight: "1.06", letterSpacing: "-.034em", fontWeight: "600" }}>The booking that costs you money: unit-night GOP explained</h1>
        <p style={{ marginTop: "20px", fontSize: "20px", lineHeight: "1.6", color: "#9BA3AB", fontFamily: "'Instrument Serif',serif", fontStyle: "italic" }}>
          Occupancy flatters you, ADR reassures you, and RevPAR still leaves out the cleaning. If you cannot say what a single night in a single unit earned you after everything, you are managing the top line and hoping about the bottom one.
        </p>
        <div style={{ marginTop: "24px", fontSize: "14px", color: "#6F787F" }}>28 July 2026 · Alisio revenue team</div>
      </div>
      <div style={{ maxWidth: "820px", margin: "44px auto 0", padding: "0 28px", fontSize: "18px", lineHeight: "1.72", color: "#C4C9CE" }}>
        <div style={{ height: "220px", borderRadius: "18px", marginBottom: "40px", background: "radial-gradient(120% 140% at 20% 10%,rgba(61,220,192,.5),transparent 55%),radial-gradient(100% 120% at 85% 80%,rgba(96,120,255,.45),transparent 60%),#0F1418" }} />
        <p>
          Every property system in the world will tell you what came in. Very few will tell you what stayed. The gap between those two numbers is where small properties quietly lose their year, and it is almost never visible in the reports the industry has trained us to look at.
        </p>
        <h2 style={{ marginTop: "38px", fontSize: "28px", fontWeight: "600", letterSpacing: "-.024em", color: "#ECEAE5" }}>The three metrics that flatter you</h2>
        <p style={{ marginTop: "14px" }}>
          Occupancy rewards you for selling cheaply, while ADR rewards you for selling expensively to fewer people. RevPAR combines them honestly enough, and then stops, because it is still a revenue metric. It knows nothing about the fifty-two minutes somebody spent cleaning that unit, the eighteen percent the channel took, the acquiring fee, the towels, the heating profile of a dome in October or the amortisation of a hot tub pump.
        </p>
        <p style={{ marginTop: "14px" }}>
          GOPPAR (gross operating profit per available room) is the honest one. The problem is that most properties compute it once a year, from accounting data that arrives forty days late, at a level of aggregation that cannot answer the only useful question:
          <em style={{ fontFamily: "'Instrument Serif',serif", fontSize: "1.05em" }}>which of my bookings should I not have taken?</em>
        </p>
        <h2 style={{ marginTop: "38px", fontSize: "28px", fontWeight: "600", letterSpacing: "-.024em", color: "#ECEAE5" }}>Subtract the night, not the month</h2>
        <p style={{ marginTop: "14px" }}>
          The unit of truth is one night in one unit. Take the revenue attached to it (the room plus whatever extras were sold with that night) and subtract, in this order, the things that actually happened:
        </p>
        <div style={{ marginTop: "22px", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "26px", background: "#0C1013", fontFamily: "'JetBrains Mono',monospace", fontSize: "14.5px", lineHeight: "2" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#B6BCC3" }}>Room revenue</span>
            <span>€168.00</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#B6BCC3" }}>Extras sold with the night</span>
            <span>€45.00</span>
          </div>
          <div style={{ height: "1px", background: "rgba(255,255,255,.1)", margin: "8px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", color: "#FF8E80" }}>
            <span>Channel commission, actual</span>
            <span>−€30.24</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#FF8E80" }}>
            <span>Acquiring fee, per transaction</span>
            <span>−€2.61</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#FF8E80" }}>
            <span>Cleaning: 52 min × shift rate</span>
            <span>−€22.00</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#FF8E80" }}>
            <span>Energy + amenities</span>
            <span>−€9.40</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#FF8E80" }}>
            <span>Amortisation of the unit</span>
            <span>−€6.80</span>
          </div>
          <div style={{ height: "1px", background: "rgba(255,255,255,.16)", margin: "8px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "18px", color: "var(--acc,#3DDCC0)" }}>
            <span>GOP for this unit-night</span>
            <span>€141.95</span>
          </div>
        </div>
        <p style={{ marginTop: "20px" }}>
          Nothing in that list is exotic. All of it is data your operation already produces, it simply lives in five different places, three of which are a person's memory. Cleaning minutes, in particular, are the line most properties never connect to revenue, and they are the line that decides whether a cheap night was worth having.
        </p>
        <h2 style={{ marginTop: "38px", fontSize: "28px", fontWeight: "600", letterSpacing: "-.024em", color: "#ECEAE5" }}>Now the uncomfortable part</h2>
        <p style={{ marginTop: "14px" }}>
          Run this for a season and a pattern appears at almost every small property. It is not the expensive units, and it is not the quiet weeks. It is
          <strong style={{ color: "#ECEAE5" }}>single nights, from one particular channel, on units that are heavy to clean</strong>
          . Full-price on paper, negative in reality, because a fixed cleaning cost is being amortised over one night instead of four.
        </p>
        <p style={{ marginTop: "14px" }}>
          The fix is boring and immediate: raise minimum length of stay on those dates for that channel, or price the single night to carry its own cleaning. Both are one rule. Neither is possible if your reports stop at RevPAR, because in RevPAR that booking looks like a success.
        </p>
        <blockquote style={{ margin: "34px 0", padding: "26px 30px", borderLeft: "2px solid var(--acc,#3DDCC0)", background: "rgba(61,220,192,.05)", borderRadius: "0 14px 14px 0", fontSize: "20px", lineHeight: "1.55", color: "#ECEAE5" }}>
          Once per-night margin is visible, pricing decisions stop being a matter of nerve and become a matter of reading the report.
        </blockquote>
        <h2 style={{ marginTop: "38px", fontSize: "28px", fontWeight: "600", letterSpacing: "-.024em", color: "#ECEAE5" }}>What to do on Monday</h2>
        <p style={{ marginTop: "14px" }}>
          You do not need new software to start. You need three numbers you probably do not have written down: the real cost of cleaning one unit of each type, your true blended commission per channel including cancellations, and the energy and amenity cost of an occupied night versus an empty one. With those three, a spreadsheet will already tell you something painful and useful.
        </p>
        <p style={{ marginTop: "14px" }}>
          What software buys you is the frequency. A number computed once a year changes nobody's behaviour. A number attached to every night, visible the morning after, changes pricing decisions all season, and that is the whole point of measuring anything.
        </p>
        <div style={{ marginTop: "48px", border: "1px solid rgba(61,220,192,.25)", borderRadius: "18px", padding: "34px", background: "radial-gradient(120% 200% at 15% 0%,rgba(61,220,192,.1),transparent 60%),#0B0E11" }}>
          <h3 style={{ fontSize: "22px", fontWeight: "600", letterSpacing: "-.02em", color: "#ECEAE5" }}>See it on your own units</h3>
          <p style={{ marginTop: "10px", fontSize: "16px", color: "#9BA3AB", lineHeight: "1.6" }}>
            Fourteen days read-only is enough for Alisio to build the first honest unit-night P&amp;L of your property, including the bookings you would rather not have taken.
          </p>
          <div style={{ marginTop: "20px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <Link href="/demo" data-route="demo" style={{ background: "var(--acc,#3DDCC0)", color: "#07100E", fontWeight: "600", fontSize: "15.5px", padding: "14px 24px", borderRadius: "11px" }}>Book a demo</Link>
            <Link href="/modules/finance" data-route="m-finance" style={{ border: "1px solid rgba(255,255,255,.18)", color: "#ECEAE5", fontWeight: "500", fontSize: "15.5px", padding: "14px 22px", borderRadius: "11px" }}>The finance module</Link>
          </div>
        </div>
        <div style={{ margin: "60px 0 120px", paddingTop: "32px", borderTop: "1px solid rgba(255,255,255,.08)" }}>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", letterSpacing: ".14em", color: "#5F676E" }}>READ NEXT</div>
          <Link href="/blog/autonomy-levels" data-route="post-autonomy" style={{ display: "block", marginTop: "14px", fontSize: "24px", fontWeight: "600", letterSpacing: "-.024em", color: "#ECEAE5" }} className="dcx-h9">Six levels of trust: how to let software price your rooms →</Link>
        </div>
      </div>
    </>
  );
}
