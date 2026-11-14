import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { useWallet } from '../near/wallet';

const icon = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);

const items: { to: string; label: string; svg: ReactNode; end?: boolean }[] = [
  { to: '/', label: 'Home', end: true, svg: icon(<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />) },
  { to: '/plan', label: 'Your plan', end: true, svg: icon(<><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></>) },
  { to: '/plan#who', label: 'Who receives what', svg: icon(<><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 3-5 6-5s6 2 6 5" /><path d="M16 5a3 3 0 0 1 0 6" /><path d="M18 15c2 .5 3 2 3 5" /></>) },
  { to: '/plan#panic', label: 'Move everything now', svg: icon(<path d="M13 3L5 13h6l-1 8 8-10h-6z" />) },
  { to: '/#how', label: 'How it works', svg: icon(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6" /><path d="M12 17h.01" /></>) },
];

export function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path d="M11 9.5a9 9 0 1 0 10 0" fill="none" stroke="#7FD1C1" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M16 5v10" stroke="#7FD1C1" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function Layout() {
  const { pathname, hash } = useLocation();
  /* Scroll to #anchors after navigation, and to the top on page changes. */
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) { setTimeout(() => el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }), 50); return; }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);

  return (
    <div className="app">
      <nav className="rail" aria-label="Main">
        <Link className="mark" to="/" aria-label="Deadswitch home"><Mark /></Link>
        {items.map((it) => it.to.includes('#')
          ? <Link key={it.to} to={it.to} title={it.label} aria-label={it.label}>{it.svg}</Link>
          : <NavLink key={it.to} to={it.to} end={it.end} title={it.label} aria-label={it.label}>{it.svg}</NavLink>)}
      </nav>
      <main>
        <div className="wrap"><Outlet /></div>
      </main>
    </div>
  );
}

/** The top bar: brand on the left, the wallet on the right. */
export function TopBar({ cta }: { cta?: ReactNode }) {
  const { accountId, connect, disconnect, loading } = useWallet();
  return (
    <header className="top">
      <Link to="/" className="brand" style={{ color: 'var(--moon)', textDecoration: 'none' }}>Deadswitch</Link>
      {cta ?? (accountId ? (
        <div className="user-menu">
          <span className="pill">{accountId}</span>
          <button type="button" className="link-btn" onClick={() => disconnect()}>Disconnect</button>
        </div>
      ) : (
        <button type="button" className="btn primary" disabled={loading} onClick={() => connect()}>Connect wallet</button>
      ))}
    </header>
  );
}
