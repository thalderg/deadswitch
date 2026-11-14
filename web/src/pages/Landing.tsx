import { Link } from 'react-router-dom';
import { TopBar } from '../components/Layout';
import { HeroScene } from '../components/Hero';

const risks: [string, string][] = [
  ['Someone gets hold of your keys.', 'Press one button and your funds move to the wallets you picked in advance, before anyone else can take them.'],
  ['Someone forces you to hand over access.', 'Your plan can’t be rewritten in a hurry. Every change waits 48 hours, and you can cancel it.'],
  ['You lose access to your own wallet.', 'Add a backup wallet of yours to the plan. When the timer runs out, your funds go there.'],
  ['You’re gone, and nobody can reach your crypto.', 'If you stop checking in, the people you chose receive their shares. No seed phrase changes hands.'],
  ['You don’t want to trust a company with your money.', 'Nothing is locked and nobody holds it for you. Your funds stay in your account until the moment they move.'],
];

export function Landing() {
  return (
    <>
      <TopBar />
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-top">
          <h1 id="hero-title">In crypto, your capital is at risk every day.</h1>
          <div className="hero-side">
            <p>Give it a plan. Your funds stay in your own NEAR Intents account, and if anything happens to you or your keys, everything goes exactly where you chose.</p>
            <div className="row">
              <Link className="btn primary" to="/setup">Set up my plan</Link>
              <Link className="btn secondary" to="/#how">See how it works</Link>
            </div>
          </div>
        </div>
        <HeroScene />
      </section>

      <section className="block" aria-labelledby="risks-title">
        <h2 id="risks-title">What could go wrong, and what happens instead</h2>
        <div>
          {risks.map(([q, a]) => (
            <div className="risk" key={q}><p className="q">{q}</p><p className="a lead">{a}</p></div>
          ))}
        </div>
      </section>

      <section className="block" aria-labelledby="impact-title">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 760 }}>
          <h2 id="impact-title" style={{ fontSize: 'clamp(36px,5vw,52px)', lineHeight: 1.05 }}>Peace of mind now. An impact that outlasts you.</h2>
          <p className="lead">One plan covers both: protection while you’re here, and a clear path for your crypto when you’re not.</p>
        </div>
        <div className="two stage">
          <div className="glass"><h3>While you’re here</h3><ul>
            <li>Use your funds as you always do. Trading, swapping and withdrawing keep working.</li>
            <li>Reminders arrive by email or Telegram, timed to your plan. One tap checks you in: no wallet, no fees.</li>
            <li>If your keys are ever at risk, one button moves everything to safety.</li></ul></div>
          <div className="glass"><h3>When you’re gone</h3><ul>
            <li>Everything goes where you want it to go: family, friends, or a cause you care about.</li>
            <li>Each person receives their share in their own account, ready to withdraw to their own wallet.</li>
            <li>Your crypto keeps doing good after you, instead of being lost forever.</li></ul></div>
        </div>
      </section>

      <section className="block" id="how" aria-labelledby="how-title">
        <h2 id="how-title">Set it up once, then forget about it</h2>
        <ol className="steps">
          <li><span className="n">1</span><h3>Choose who receives what</h3><p className="lead">Connect your NEAR wallet and split your funds between the people and causes you choose.</p></li>
          <li><span className="n">2</span><h3>Give the switch one permission</h3><p className="lead">Approve a single key on your NEAR Intents account. Your funds don’t move, and you can remove it any time.</p></li>
          <li><span className="n">3</span><h3>Keep living your life</h3><p className="lead">We remind you before your timer runs out. Tap “I’m still here” in an email or Telegram message, or check in on the website.</p></li>
        </ol>
      </section>

      <section className="band outline" aria-labelledby="covers-title">
        <div><h2 id="covers-title" style={{ fontSize: 38 }}>Works with what you hold in NEAR Intents</h2>
          <p className="lead">Real assets from many networks, in your own account. Each person can withdraw their share to their own wallet on that network.</p></div>
        <ul className="chips"><li>NEAR</li><li>Bitcoin</li><li>Ethereum</li><li>Solana</li><li>USDC</li><li className="more">and every other token NEAR Intents supports</li></ul>
      </section>

      <section className="band glass" aria-labelledby="pricing-title" style={{ flexDirection: 'row', padding: 44 }}>
        <div><h2 id="pricing-title" style={{ fontSize: 'clamp(36px,5vw,52px)', lineHeight: 1.05 }}>Free during the beta</h2>
          <p className="lead">After the beta, reminders by email and Telegram will cost about $10 a year, payable in USDC or any NEAR Intents token. Checking in is always free for you: we pay the network fee.</p></div>
        <Link className="btn primary" to="/setup" style={{ alignSelf: 'center' }}>Set up my plan</Link>
      </section>

      <section className="block" aria-labelledby="trust-title" style={{ paddingTop: 0 }}>
        <h2 id="trust-title">Built so nobody has to be trusted</h2>
        <div className="trust">
          <div><h3>No one holds the key</h3><p className="lead">The switch’s key is split across NEAR’s network of independent operators. The whole key never exists in one place.</p></div>
          <div><h3>The rules are public</h3><p className="lead">An open contract decides when the key can be used, and your plan decides where funds go. Anyone can check both.</p></div>
          <div><h3>You stay in control</h3><p className="lead">Change your plan, pause the switch or remove its permission whenever you want.</p></div>
        </div>
      </section>

      <footer className="foot"><span>Built at NEAR HACKATHON on NEAR Intents and Chain Signatures.</span><span>A prototype, not a legal will.</span></footer>
    </>
  );
}
