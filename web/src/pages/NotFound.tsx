import { Link } from 'react-router-dom';
import { TopBar } from '../components/Layout';

export function NotFound() {
  return (
    <>
      <TopBar />
      <section className="center-page">
        <h1>This page doesn’t exist</h1>
        <p className="lead">The link may be old or mistyped.</p>
        <div className="row"><Link className="btn primary" to="/">Go to the home page</Link><Link className="btn secondary" to="/plan">Go to my plan</Link></div>
      </section>
    </>
  );
}
