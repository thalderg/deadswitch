import { config } from './config';
import { escapeHtml } from './format';

/** A small page in the site's design (served for one-time check-in links). */
export function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)} · Deadswitch</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Geist:wght@400;500;600&display=swap">
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;background:#05070D;color:#EEF1F8;font-family:Geist,'Helvetica Neue',Arial,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px 16px;box-sizing:border-box;
  background-image:radial-gradient(ellipse 50% 60% at 50% -10%,rgba(150,185,230,.18),transparent 70%)}
main{max-width:560px;width:100%;background:rgba(16,24,36,.8);border:1px solid rgba(127,209,193,.14);border-radius:28px;padding:36px;box-sizing:border-box}
.brand{font-family:'Instrument Serif',Georgia,serif;font-size:26px;margin:0 0 24px}
h1{font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:44px;line-height:1.05;margin:0 0 16px}
p{color:#A7B1C8;font-size:17px;line-height:1.6;margin:0 0 16px}
.small{font-size:14px}
button,.btn{display:inline-flex;align-items:center;justify-content:center;min-height:50px;padding:0 28px;border-radius:999px;border:0;background:#7FD1C1;color:#05070D;font:600 16px Geist,Arial,sans-serif;cursor:pointer;text-decoration:none}
button:focus-visible,a:focus-visible{outline:2px solid #7FD1C1;outline-offset:3px}
a{color:#7FD1C1}
</style></head><body><main><p class="brand">Deadswitch</p>${body}
<p class="small">You can also check in any time on the website: <a href="${escapeHtml(config.siteUrl)}/plan">${escapeHtml(config.siteUrl)}</a></p></main></body></html>`;
}
