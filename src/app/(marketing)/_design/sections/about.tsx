/**
 * Generated from the Alisio PMS design export by scripts/port-design.mjs.
 * Hand edits here are lost on the next run — change the design source instead.
 */
import Link from 'next/link';

export default function SectionAbout() {
  return (
    <>
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "80px 28px 0" }}>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11.5px", letterSpacing: ".16em", color: "var(--acc,#3DDCC0)" }}>COMPANY</div>
        <h1 style={{ marginTop: "18px", fontSize: "clamp(38px,5.4vw,66px)", lineHeight: "1.02", letterSpacing: "-.036em", fontWeight: "600", maxWidth: "20ch" }}>We build the system we needed while running a property ourselves.</h1>
        <p style={{ marginTop: "22px", fontSize: "19px", lineHeight: "1.6", color: "#9BA3AB", maxWidth: "62ch" }}>
          Alisio PMS is made by ROZUM, a product company in Central Europe. It started because the software available to independent properties assumed a team that independent properties do not have, and because the boring work, the filings and the follow-ups and the failed cards, was eating the part of the job that people actually got into hospitality for.
        </p>
      </div>
      <div style={{ maxWidth: "1280px", margin: "56px auto 0", padding: "0 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "16px" }}>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "30px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "20px", fontWeight: "600" }}>Operators first, engineers second</h3>
            <p style={{ marginTop: "10px", fontSize: "15.5px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Every feature is argued against a real shift: a Friday with two early arrivals, a broken shower tray and a group whose deposit has not landed. If it does not survive that, it does not ship.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .06s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "30px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "20px", fontWeight: "600" }}>Nothing hostage</h3>
            <p style={{ marginTop: "10px", fontSize: "15.5px", lineHeight: "1.6", color: "#9BA3AB" }}>
              No setup fee, no exit fee, no charge for integrations or extra users, and a one-click full export in open formats on any day of the contract. Software should be kept because it works, not because leaving is expensive.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .12s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "30px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "20px", fontWeight: "600" }}>Prove it or drop it</h3>
            <p style={{ marginTop: "10px", fontSize: "15.5px", lineHeight: "1.6", color: "#9BA3AB" }}>
              A permanent randomised holdout means our claims about revenue are measured against your own rules, on your own property. We would rather you were able to check our numbers than impressed by them.
            </p>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: "1280px", margin: "80px auto 0", padding: "0 28px" }}>
        <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "20px", padding: "44px", background: "#0C1013" }}>
          <h2 style={{ fontSize: "30px", fontWeight: "600", letterSpacing: "-.028em" }}>What we believe about automation in hospitality</h2>
          <div style={{ marginTop: "26px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "30px 44px", fontSize: "16.5px", lineHeight: "1.65", color: "#9BA3AB" }}>
            <p>
              <strong style={{ color: "#ECEAE5", display: "block" }}>Routine work should be automated, hospitality should not.</strong>
              The goal is not a hotel without staff. It is staff who spend their hours on the guest in front of them instead of on a registration form.
            </p>
            <p>
              <strong style={{ color: "#ECEAE5", display: "block" }}>A decision you cannot inspect is a decision you cannot trust.</strong>
              Every automated action keeps its inputs, its reason and its measured effect, permanently, exportably, for an auditor or for an argument.
            </p>
            <p>
              <strong style={{ color: "#ECEAE5" }}>Autonomy is a dial, not a switch.</strong>
              Properties differ, seasons differ, and the right level of delegation in July is not the right level in February. The control stays with the owner.
            </p>
            <p>
              <strong style={{ color: "#ECEAE5" }}>Small properties deserve enterprise mechanics.</strong>
              Per-unit profitability, holdout testing and structured compliance are not luxuries for chains. They are simply what running a business well requires.
            </p>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: "1280px", margin: "70px auto 0", padding: "0 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "16px" }}>
          <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "26px", background: "#0C1013" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", letterSpacing: ".14em", color: "#5F676E" }}>BASED IN</div>
            <div style={{ marginTop: "8px", fontSize: "17px" }}>Central Europe · EU hosting only</div>
          </div>
          <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "26px", background: "#0C1013" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", letterSpacing: ".14em", color: "#5F676E" }}>LANGUAGES</div>
            <div style={{ marginTop: "8px", fontSize: "17px" }}>Product and support in EN, CS, DE, UK</div>
          </div>
          <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "26px", background: "#0C1013" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", letterSpacing: ".14em", color: "#5F676E" }}>CURRENCIES</div>
            <div style={{ marginTop: "8px", fontSize: "17px" }}>EUR and CZK, side by side</div>
          </div>
          <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "26px", background: "#0C1013" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", letterSpacing: ".14em", color: "#5F676E" }}>ONBOARDING</div>
            <div style={{ marginTop: "8px", fontSize: "17px" }}>Done with you, not sold to you</div>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: "1280px", margin: "80px auto 0", padding: "0 28px 120px" }}>
        <div style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: "20px", padding: "44px", display: "flex", gap: "28px", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", background: "#0B0E11" }}>
          <div>
            <h2 style={{ fontSize: "26px", fontWeight: "600", letterSpacing: "-.02em" }}>Talk to the people who build it</h2>
            <p style={{ marginTop: "8px", fontSize: "16px", color: "#9BA3AB" }}>Demos are run by the product team.</p>
          </div>
          <Link href="/demo" data-route="demo" style={{ background: "var(--acc,#3DDCC0)", color: "#07100E", fontWeight: "600", fontSize: "16px", padding: "15px 26px", borderRadius: "12px" }}>Book a demo</Link>
        </div>
      </div>
    </>
  );
}
