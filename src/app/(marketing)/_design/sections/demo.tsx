/**
 * Generated from the Alisio PMS design export by scripts/port-design.mjs.
 * Hand edits here are lost on the next run — change the design source instead.
 */

export default function SectionDemo() {
  return (
    <>
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "80px 28px 0" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.05fr .95fr", gap: "56px", alignItems: "start" }}>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11.5px", letterSpacing: ".16em", color: "var(--acc,#3DDCC0)" }}>BOOK A DEMO</div>
            <h1 style={{ marginTop: "18px", fontSize: "clamp(36px,4.8vw,58px)", lineHeight: "1.04", letterSpacing: "-.034em", fontWeight: "600", maxWidth: "20ch" }}>Forty minutes, your units on screen, no slides.</h1>
            <p style={{ marginTop: "20px", fontSize: "18.5px", lineHeight: "1.6", color: "#9BA3AB", maxWidth: "56ch" }}>
              We load your unit list and channel mix before the call, so what you see is your property in Alisio, the tape, the unit-night margins, and what the crew would have done last week.
            </p>
            <div style={{ marginTop: "34px", display: "grid", gap: "16px", fontSize: "16px", lineHeight: "1.6" }}>
              <div style={{ display: "flex", gap: "14px" }}>
                <span style={{ color: "var(--acc,#3DDCC0)", fontFamily: "'JetBrains Mono',monospace" }}>01</span>
                <div>
                  <strong style={{ color: "#ECEAE5" }}>The call.</strong>
                  <span style={{ color: "#9BA3AB" }}>
                    You talk, we listen, then we show the two or three things that matter for your kind of property.
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", gap: "14px" }}>
                <span style={{ color: "var(--acc,#3DDCC0)", fontFamily: "'JetBrains Mono',monospace" }}>02</span>
                <div>
                  <strong style={{ color: "#ECEAE5" }}>Shadow mode, fourteen days.</strong>
                  <span style={{ color: "#9BA3AB" }}>
                    Read-only beside your current system. It decides everything, executes nothing, logs all of it. Setup is under an hour.
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", gap: "14px" }}>
                <span style={{ color: "var(--acc,#3DDCC0)", fontFamily: "'JetBrains Mono',monospace" }}>03</span>
                <div>
                  <strong style={{ color: "#ECEAE5" }}>The shadow report.</strong>
                  <span style={{ color: "#9BA3AB" }}>
                    What not having it cost you, decision by decision. Then you decide, and if the answer is no, you have still learned something about your property.
                  </span>
                </div>
              </div>
            </div>
            <div style={{ marginTop: "36px", paddingTop: "28px", borderTop: "1px solid rgba(255,255,255,.08)", display: "grid", gap: "10px", fontSize: "15px", color: "#8B939C" }}>
              <div>
                Pricing is quoted per property: a base per active unit plus a share of the proven uplift. Quoted in EUR and CZK.
              </div>
              <div>No setup fee · no exit fee · integrations included · full export any day.</div>
            </div>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(20px)", transition: "all .7s ease", border: "1px solid rgba(255,255,255,.12)", borderRadius: "20px", padding: "34px", background: "#0C1013", boxShadow: "0 40px 100px rgba(0,0,0,.5)" }}>
            <h2 style={{ fontSize: "22px", fontWeight: "600", letterSpacing: "-.02em" }}>Request a quote</h2>
            <p style={{ marginTop: "8px", fontSize: "14.5px", color: "#8B939C" }}>A person replies within one working day.</p>
            <div style={{ marginTop: "24px", display: "grid", gap: "14px" }}>
              <label style={{ display: "block" }}>
                <span style={{ display: "block", fontSize: "12px", letterSpacing: ".1em", color: "#5F676E", fontFamily: "'JetBrains Mono',monospace" }}>PROPERTY NAME</span>
                <input type="text" placeholder="Aurora Valley Camp" style={{ marginTop: "7px", width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.12)", borderRadius: "11px", padding: "13px 14px", color: "#ECEAE5", fontSize: "15px", fontFamily: "'Instrument Sans',sans-serif", outline: "none" }} />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                <label style={{ display: "block" }}>
                  <span style={{ display: "block", fontSize: "12px", letterSpacing: ".1em", color: "#5F676E", fontFamily: "'JetBrains Mono',monospace" }}>UNITS</span>
                  <input type="text" placeholder="18" style={{ marginTop: "7px", width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.12)", borderRadius: "11px", padding: "13px 14px", color: "#ECEAE5", fontSize: "15px", fontFamily: "'Instrument Sans',sans-serif", outline: "none" }} />
                </label>
                <label style={{ display: "block" }}>
                  <span style={{ display: "block", fontSize: "12px", letterSpacing: ".1em", color: "#5F676E", fontFamily: "'JetBrains Mono',monospace" }}>PROPERTIES</span>
                  <input type="text" placeholder="1" style={{ marginTop: "7px", width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.12)", borderRadius: "11px", padding: "13px 14px", color: "#ECEAE5", fontSize: "15px", fontFamily: "'Instrument Sans',sans-serif", outline: "none" }} />
                </label>
              </div>
              <div>
                <span style={{ display: "block", fontSize: "12px", letterSpacing: ".1em", color: "#5F676E", fontFamily: "'JetBrains Mono',monospace" }}>PROPERTY TYPE</span>
                <div data-chips={true} style={{ marginTop: "9px", display: "flex", flexWrap: "wrap", gap: "8px", fontSize: "13.5px" }}>
                  <button data-chip={true} style={{ all: "unset", cursor: "pointer", border: "1px solid rgba(61,220,192,.45)", background: "rgba(61,220,192,.1)", color: "#ECEAE5", borderRadius: "99px", padding: "8px 14px" }} type="button">Glamping</button>
                  <button data-chip={true} style={{ all: "unset", cursor: "pointer", border: "1px solid rgba(255,255,255,.12)", color: "#B6BCC3", borderRadius: "99px", padding: "8px 14px" }} type="button">Boutique hotel</button>
                  <button data-chip={true} style={{ all: "unset", cursor: "pointer", border: "1px solid rgba(255,255,255,.12)", color: "#B6BCC3", borderRadius: "99px", padding: "8px 14px" }} type="button">Apart-complex</button>
                  <button data-chip={true} style={{ all: "unset", cursor: "pointer", border: "1px solid rgba(255,255,255,.12)", color: "#B6BCC3", borderRadius: "99px", padding: "8px 14px" }} type="button">Resort</button>
                  <button data-chip={true} style={{ all: "unset", cursor: "pointer", border: "1px solid rgba(255,255,255,.12)", color: "#B6BCC3", borderRadius: "99px", padding: "8px 14px" }} type="button">Group / mgmt co.</button>
                </div>
              </div>
              <label style={{ display: "block" }}>
                <span style={{ display: "block", fontSize: "12px", letterSpacing: ".1em", color: "#5F676E", fontFamily: "'JetBrains Mono',monospace" }}>WORK E-MAIL</span>
                <input type="email" placeholder="you@property.com" style={{ marginTop: "7px", width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.12)", borderRadius: "11px", padding: "13px 14px", color: "#ECEAE5", fontSize: "15px", fontFamily: "'Instrument Sans',sans-serif", outline: "none" }} />
              </label>
              <label style={{ display: "block" }}>
                <span style={{ display: "block", fontSize: "12px", letterSpacing: ".1em", color: "#5F676E", fontFamily: "'JetBrains Mono',monospace" }}>WHAT HURTS MOST RIGHT NOW</span>
                <textarea rows={3} placeholder="Booking.com messages at midnight, and I have no idea which units actually make money." style={{ marginTop: "7px", width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.12)", borderRadius: "11px", padding: "13px 14px", color: "#ECEAE5", fontSize: "15px", fontFamily: "'Instrument Sans',sans-serif", outline: "none", resize: "vertical" }} />
              </label>
              <button data-submit={true} style={{ all: "unset", cursor: "pointer", textAlign: "center", background: "var(--acc,#3DDCC0)", color: "#07100E", fontWeight: "600", fontSize: "16px", padding: "15px", borderRadius: "12px", marginTop: "4px" }} type="button">Request a quote</button>
              <div data-form-note={true} style={{ fontSize: "12.5px", color: "#5F676E", lineHeight: "1.5" }}>
                This is a design prototype, the form does not send anything yet. Your data would be processed under GDPR and never shared.
              </div>
            </div>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: "1280px", margin: "90px auto 0", padding: "0 28px 120px" }}>
        <h2 style={{ fontSize: "30px", fontWeight: "600", letterSpacing: "-.028em" }}>Questions we get asked before the call</h2>
        <div style={{ marginTop: "26px", display: "grid", gap: "10px" }}>
          <div data-acc={true} style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "14px", background: "#0C1013", overflow: "hidden" }}>
            <div data-acc-head={true} style={{ padding: "20px 24px", display: "flex", alignItems: "center", gap: "20px" }}>
              <strong style={{ fontSize: "17.5px", fontWeight: "600", flex: "1" }}>Do we have to switch systems to try it?</strong>
              <span data-acc-icon={true} style={{ color: "#5F676E", transition: "transform .3s ease" }}>+</span>
            </div>
            <div data-acc-body={true} style={{ display: "none", padding: "0 24px 22px", fontSize: "16px", lineHeight: "1.65", color: "#9BA3AB", maxWidth: "80ch" }}>
              No. Shadow mode runs read-only alongside whatever you use today for fourteen days. Nothing is written to your channels, nothing is sent to your guests. You get a log of what would have happened and a number for what it was worth.
            </div>
          </div>
          <div data-acc={true} style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "14px", background: "#0C1013", overflow: "hidden" }}>
            <div data-acc-head={true} style={{ padding: "20px 24px", display: "flex", alignItems: "center", gap: "20px" }}>
              <strong style={{ fontSize: "17.5px", fontWeight: "600", flex: "1" }}>What happens to our data if we leave?</strong>
              <span data-acc-icon={true} style={{ color: "#5F676E", transition: "transform .3s ease" }}>+</span>
            </div>
            <div data-acc-body={true} style={{ display: "none", padding: "0 24px 22px", fontSize: "16px", lineHeight: "1.65", color: "#9BA3AB", maxWidth: "80ch" }}>
              You export everything, bookings, guests, folios, documents and the full decision Ledger, in open formats, on any day, in one click. There is no exit fee and no retention period on your own records.
            </div>
          </div>
          <div data-acc={true} style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "14px", background: "#0C1013", overflow: "hidden" }}>
            <div data-acc-head={true} style={{ padding: "20px 24px", display: "flex", alignItems: "center", gap: "20px" }}>
              <strong style={{ fontSize: "17.5px", fontWeight: "600", flex: "1" }}>Can we keep the AI switched off?</strong>
              <span data-acc-icon={true} style={{ color: "#5F676E", transition: "transform .3s ease" }}>+</span>
            </div>
            <div data-acc-body={true} style={{ display: "none", padding: "0 24px 22px", fontSize: "16px", lineHeight: "1.65", color: "#9BA3AB", maxWidth: "80ch" }}>
              Completely. With every agent at L0 you have a well-built cloud PMS with a channel manager, a guest portal and honest unit-night finance. Some properties stay there for a season, then move messaging to drafts, then never look back.
            </div>
          </div>
          <div data-acc={true} style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "14px", background: "#0C1013", overflow: "hidden" }}>
            <div data-acc-head={true} style={{ padding: "20px 24px", display: "flex", alignItems: "center", gap: "20px" }}>
              <strong style={{ fontSize: "17.5px", fontWeight: "600", flex: "1" }}>How long does migration take in season?</strong>
              <span data-acc-icon={true} style={{ color: "#5F676E", transition: "transform .3s ease" }}>+</span>
            </div>
            <div data-acc-body={true} style={{ display: "none", padding: "0 24px 22px", fontSize: "16px", lineHeight: "1.65", color: "#9BA3AB", maxWidth: "80ch" }}>
              Typically one week from shadow mode to live, with the channel cutover done on your quietest weekday and the old system left readable behind you. Existing reservations, guest history and open folios come across; there is no blackout window for reception.
            </div>
          </div>
          <div data-acc={true} style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "14px", background: "#0C1013", overflow: "hidden" }}>
            <div data-acc-head={true} style={{ padding: "20px 24px", display: "flex", alignItems: "center", gap: "20px" }}>
              <strong style={{ fontSize: "17.5px", fontWeight: "600", flex: "1" }}>Why is there no price list on the site?</strong>
              <span data-acc-icon={true} style={{ color: "#5F676E", transition: "transform .3s ease" }}>+</span>
            </div>
            <div data-acc-body={true} style={{ display: "none", padding: "0 24px 22px", fontSize: "16px", lineHeight: "1.65", color: "#9BA3AB", maxWidth: "80ch" }}>
              Because part of the price is a share of proven uplift, and that only means something once we know your unit count, channel mix and how much of the routine you want the crew to carry. Send those three and you get a real number in EUR and CZK, not a tier.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
