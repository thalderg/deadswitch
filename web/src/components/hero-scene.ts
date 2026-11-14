/* The landing-page hero: restless wires (one per coin) flow into a seed inside a
   power-symbol pot, and a bonsai grows from it. Its branches lead to the people in
   the plan, a backup wallet, and "sent to safety". Ported from design/v2-mockup.html. */
/* eslint-disable */
// @ts-nocheck

export interface Hero { stop: () => void; replay: (() => void) | null }

export function startHero(cv: HTMLCanvasElement, reduce: boolean): Hero {
  let stopped = false, raf = 0, timer: any = 0, io: IntersectionObserver | null = null;
  let replay: (() => void) | null = null;
  /* ---------- hero: a few restless wires -> a bonsai that grows -> three outcomes ---------- */
  function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
  const ctx = cv.getContext('2d')!;
  const W = 1100, H = 460;
  const BASE = {x: 556, y: 360};   // centre of the power-symbol pot
  const RING = 34;
  const rnd = mulberry32(20261114);
  const pick = arr => arr[Math.floor(rnd()*arr.length)];
  const smooth = (a,b,x) => { const t = Math.min(1, Math.max(0, (x-a)/(b-a))); return t*t*(3-2*t); };
  const bez = (p0,p1,p2,p3,u) => { const v = 1-u; return [v*v*v*p0[0]+3*v*v*u*p1[0]+3*v*u*u*p2[0]+u*u*u*p3[0], v*v*v*p0[1]+3*v*v*u*p1[1]+3*v*u*u*p2[1]+u*u*u*p3[1]]; };

  /* one restless wire per coin you hold, all ending in the switch */
  const coins = ['Bitcoin','Ethereum','NEAR','USDC','USDT','Solana','Zcash','Any NEAR Intents asset'];
  const wires = coins.map((name, i) => {
    const p = () => [140 + rnd()*300, 60 + rnd()*340];
    return {name, p0: [i === coins.length - 1 ? 196 : 130 + rnd()*50, 80 + i*40], c1: p(), c2: p(), c3: p(), end: BASE.y - 9 + i*2.4,
      color: ['240,163,94','238,241,248','167,177,200'][i % 3], a: .55, w: 1.7,
      ph: rnd()*Math.PI*2, sp: .6 + rnd()*1.0, amp: 22 + rnd()*30};
  });
  /* the bonsai: limbs as cubic curves [p0, p1, p2, p3, startWidth, endWidth, growFrom, growTo] */
  const TRUNK = [[556,360],[556,300],[612,290],[566,226], 13, 7, 0, .32];
  const limbs = [
    TRUNK,
    [[566,236],[560,214],[570,200],[562,186], 6, 3, .22, .4],              // apex
    [[574,258],[604,226],[628,178],[662,152], 7, 3.5, .28, .52],           // plan branch
    [[662,152],[676,128],[694,108],[716,96], 3.2, 1.6, .5, .66],           //   twig: Anna
    [[662,152],[684,150],[702,150],[724,150], 3.2, 1.6, .52, .68],         //   twig: Marco
    [[662,152],[676,174],[694,196],[714,206], 3.2, 1.6, .54, .7],          //   twig: cause
    [[584,310],[616,318],[646,300],[690,292], 6.5, 2.6, .34, .58],         // backup branch
    [[568,306],[606,326],[646,360],[684,372], 6, 2.4, .4, .64],            // panic branch
    [[574,280],[546,270],[514,262],[488,262], 4.5, 2, .36, .56]            // small left branch, for balance
  ];
  /* foliage pads: centre, radius, when they appear */
  const pads = [[562,184,30,.38],[718,96,22,.62],[728,150,22,.64],[716,208,22,.66],[694,290,26,.56],[688,372,24,.62],[486,260,22,.56],[640,170,20,.5]]
    .map(([x,y,r,at]) => ({x, y, r, at, dots: Array.from({length: 26}, () => {
      const a = rnd()*Math.PI*2, d = Math.sqrt(rnd());
      return {dx: Math.cos(a)*r*d*1.25, dy: Math.sin(a)*r*d*.62 - r*.12, s: 3 + rnd()*5, g: pick(['90,180,130','127,209,193','150,225,185','70,160,120']), ph: rnd()*6};
    })}));
  /* where each branch leads */
  const outs = [
    {from: [716,96],  y: 70,  name: 'Anna', sub: '50%', at: .7},
    {from: [724,150], y: 130, name: 'Marco', sub: '30%', at: .72},
    {from: [714,206], y: 190, name: 'A cause you care about', sub: '20%', at: .74},
    {from: [690,292], y: 290, name: 'Your backup wallet', sub: 'if you lose access to yours', at: .76},
    {from: [684,372], y: 386, name: 'Sent to safety, now', sub: 'if someone gets hold of your keys', at: .78, ember: true}
  ];

  let bolt = null, flash = 0, nextFlash = 1.6;
  function makeBolt(){
    const pts = []; let x = 70 + rnd()*300, y = 40 + rnd()*60;
    pts.push([x,y]);
    for (let i = 0; i < 6; i++){ y += 16 + rnd()*20; x += (rnd() - .5)*36; pts.push([x,y]); }
    return pts;
  }

  let scale = 1, wide = true;
  function fit(){
    const w = cv.clientWidth || W, dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = Math.round(w*dpr); cv.height = Math.round(w*dpr*H/W);
    scale = cv.width / W; wide = w > 700;
  }
  fit();
  let lastT = 99, grow = 1, tg = 1, growing = false;
  const onResize = () => { fit(); draw(lastT, 0); };
  addEventListener('resize', onResize);
  if (document.fonts) document.fonts.ready.then(() => draw(lastT, 0));

  function limb([p0,p1,p2,p3,w0,w1,a,b], sway){
    const k = smooth(a, b, tg); if (k <= 0) return;
    const sw = ([x,y]) => [x + sway*(BASE.y - y)*.012, y];
    const q0 = sw(p0), q1 = sw(p1), q2 = sw(p2), q3 = sw(p3);
    const steps = 22, n = Math.max(1, Math.round(steps*k));
    let prev = bez(q0,q1,q2,q3,0);
    for (let i = 1; i <= n; i++){
      const u = i/steps*Math.min(1, k*steps/n), pt = bez(q0,q1,q2,q3,u);
      ctx.lineWidth = w0 + (w1 - w0)*u;
      ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(pt[0], pt[1]); ctx.stroke();
      prev = pt;
    }
  }

  function draw(t, dt){
    lastT = t;
    tg = Math.max(0, (grow - .16)/.84);          // first the seed, then the tree
    ctx.setTransform(scale,0,0,scale,0,0);
    ctx.fillStyle = '#121A2E'; ctx.fillRect(0,0,W,H);
    let g = ctx.createLinearGradient(0,0,520,0);
    g.addColorStop(0,'rgba(5,7,13,.7)'); g.addColorStop(1,'rgba(5,7,13,0)');
    ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
    /* soft light falling on the tree */
    g = ctx.createLinearGradient(0,0,0,BASE.y);
    g.addColorStop(0,'rgba(200,225,240,.12)'); g.addColorStop(1,'rgba(127,209,193,.02)');
    const LX = 610;   // the beam's centre line, over the middle of the tree
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(LX - 60, 0); ctx.lineTo(LX + 60, 0); ctx.lineTo(LX + 168, H); ctx.lineTo(LX - 168, H); ctx.closePath(); ctx.fill();
    g = ctx.createRadialGradient(LX, 150, 0, LX, 150, 220);
    g.addColorStop(0, 'rgba(200,225,240,.08)'); g.addColorStop(1, 'rgba(200,225,240,0)');
    ctx.fillStyle = g; ctx.fillRect(LX - 220, 0, 440, H);

    /* a flash now and then */
    if (flash > 0 && bolt){
      g = ctx.createRadialGradient(bolt[0][0], bolt[0][1] + 60, 0, bolt[0][0], bolt[0][1] + 60, 320);
      g.addColorStop(0, `rgba(200,215,255,${.22*flash})`); g.addColorStop(1,'rgba(200,215,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0,0,560,H);
      ctx.save(); ctx.strokeStyle = `rgba(240,244,255,${.8*flash})`; ctx.shadowColor = 'rgba(170,195,255,.9)'; ctx.shadowBlur = 16; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
      ctx.beginPath(); bolt.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y)); ctx.stroke(); ctx.restore();
    }

    /* the restless wires */
    ctx.lineCap = 'round';
    for (const w of wires){
      const k = w.amp, s = Math.sin(t*w.sp + w.ph), c = Math.cos(t*w.sp*.8 + w.ph*1.3);
      ctx.strokeStyle = `rgba(${w.color},${w.a + flash*.3})`; ctx.lineWidth = w.w;
      ctx.beginPath();
      const sx0 = w.p0[0] + s*k*.35, sy0 = w.p0[1] + c*k*.25;
      ctx.moveTo(sx0, sy0);
      ctx.bezierCurveTo(w.c1[0] + c*k, w.c1[1] + s*k, w.c2[0] - s*k, w.c2[1] + c*k, w.c3[0] + c*k*.7, w.c3[1] - s*k*.7);
      ctx.bezierCurveTo(470 + s*k*.3, w.end + c*k*.3, 500, w.end, BASE.x - RING - 2, w.end);
      ctx.stroke();
      ctx.fillStyle = `rgba(${w.color},.95)`; ctx.beginPath(); ctx.arc(sx0, sy0, 3.5, 0, 7); ctx.fill();
      ctx.fillStyle = '#EEF1F8'; ctx.font = (wide ? '500 15px' : '500 26px') + ' Geist, Arial, sans-serif';
      ctx.textAlign = 'right'; ctx.fillText(w.name, sx0 - 10, sy0 + 5); ctx.textAlign = 'left';
    }

    /* glow behind the tree, breathing slowly */
    const breath = .5 + .5*Math.sin(t*2*Math.PI/6);
    g = ctx.createRadialGradient(600, 250, 20, 600, 250, 190 + breath*20);
    g.addColorStop(0, `rgba(127,209,193,${(.1 + breath*.06)*grow})`); g.addColorStop(1,'rgba(127,209,193,0)');
    ctx.fillStyle = g; ctx.fillRect(380, 40, 440, 420);

    /* lines from the branches to each outcome */
    for (const o of outs){
      const k = smooth(o.at, o.at + .2, tg); if (k <= 0) continue;
      const end = [800, o.y], c1 = [o.from[0] + 50, o.from[1]], c2 = [740, o.y];
      ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = o.ember ? 'rgba(240,163,94,.9)' : '#7FD1C1'; ctx.lineWidth = 2;
      ctx.shadowColor = o.ember ? 'rgba(240,163,94,.5)' : 'rgba(127,209,193,.5)'; ctx.shadowBlur = 8;
      ctx.beginPath(); let first = true;
      for (let u = 0; u <= k + .001; u += .04){ const [x,y] = bez(o.from, c1, c2, end, Math.min(u,1)); first ? ctx.moveTo(x,y) : ctx.lineTo(x,y); first = false; }
      ctx.stroke(); ctx.shadowBlur = 0;
      if (k > .98){
        ctx.fillStyle = o.ember ? '#F0A35E' : '#7FD1C1'; ctx.beginPath(); ctx.arc(810, o.y, 7, 0, 7); ctx.fill();
        if (wide){
          ctx.fillStyle = '#EEF1F8'; ctx.font = '500 18px Geist, Arial, sans-serif'; ctx.fillText(o.name, 830, o.y - 3);
          ctx.fillStyle = '#A7B1C8'; ctx.font = '14px Geist, Arial, sans-serif'; ctx.fillText(o.sub, 830, o.y + 17);
        }
      }
      ctx.restore();
    }
    if (wide && grow > .9){
      ctx.fillStyle = '#A7B1C8'; ctx.font = '14px Geist, Arial, sans-serif';
      ctx.fillText('If you stop checking in', 830, 30);
    }

    /* the pot is the universal power symbol: an open ring; the trunk rises through its gap as the bar */
    {
      const br = .5 + .5*Math.sin(t*2*Math.PI/6);
      g = ctx.createRadialGradient(BASE.x, BASE.y, RING - 6, BASE.x, BASE.y, RING + 40);
      g.addColorStop(0, `rgba(127,209,193,${.12 + br*.08})`); g.addColorStop(1, 'rgba(127,209,193,0)');
      ctx.fillStyle = g; ctx.fillRect(BASE.x - RING - 40, BASE.y - RING - 40, (RING + 40)*2, (RING + 40)*2);
      ctx.save(); ctx.fillStyle = 'rgba(13,20,36,.9)'; ctx.beginPath(); ctx.arc(BASE.x, BASE.y, RING, 0, 7); ctx.fill();
      ctx.strokeStyle = '#7FD1C1'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(127,209,193,.9)'; ctx.shadowBlur = 10 + 8*br;
      ctx.beginPath(); ctx.arc(BASE.x, BASE.y, RING, -Math.PI/2 + .62, -Math.PI/2 - .62 + Math.PI*2); ctx.stroke();
      ctx.restore();
    }

    /* the seed: appears first, glows, then the tree sprouts from it */
    {
      const sk = smooth(0, .1, grow), pulse = .5 + .5*Math.sin(t*3);
      const seedGlow = sk*(1 - .6*tg);
      if (sk > 0){
        const sx = BASE.x, sy = BASE.y;
        g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 60);
        g.addColorStop(0, `rgba(127,209,193,${.45*seedGlow*(.7 + .3*pulse)})`); g.addColorStop(1, 'rgba(127,209,193,0)');
        ctx.fillStyle = g; ctx.fillRect(sx - 60, sy - 60, 120, 120);
        ctx.save(); ctx.fillStyle = '#E6FFF6'; ctx.shadowColor = 'rgba(127,209,193,1)'; ctx.shadowBlur = 18*sk;
        ctx.beginPath(); ctx.ellipse(sx, sy, 8*sk, 5.5*sk, -.3, 0, 7); ctx.fill(); ctx.restore();
        if (wide && tg < .05){ ctx.fillStyle = `rgba(167,177,200,${sk})`; ctx.font = '14px Geist, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('You plant one seed', sx, sy - 40); ctx.textAlign = 'left'; }
      }
    }

    /* the tree */
    const sway = reduce ? 0 : Math.sin(t*.6)*.9;
    ctx.save(); ctx.lineCap = 'round';
    g = ctx.createLinearGradient(0, BASE.y, 0, 90);
    g.addColorStop(0, '#7FD1C1'); g.addColorStop(.3, '#A9B6CC'); g.addColorStop(1, '#D7DEEA');
    ctx.strokeStyle = g; ctx.shadowColor = 'rgba(127,209,193,.35)'; ctx.shadowBlur = 6;
    for (const l of limbs) limb(l, sway);
    ctx.restore();
    /* foliage: soft clouds of leaves, as on a bonsai */
    ctx.save();
    for (const p of pads){
      const k = smooth(p.at, p.at + .18, tg); if (k <= 0) continue;
      const sx = sway*(BASE.y - p.y)*.012;
      ctx.shadowColor = 'rgba(127,209,193,.55)'; ctx.shadowBlur = 10;
      for (const d of p.dots){
        const wob = reduce ? 0 : Math.sin(t*1.1 + d.ph)*.8;
        ctx.fillStyle = `rgba(${d.g},${.75*k})`;
        ctx.beginPath(); ctx.ellipse(p.x + sx + d.dx*k + wob, p.y + d.dy*k, d.s*k, d.s*.7*k, .4, 0, 7); ctx.fill();
      }
    }
    ctx.restore();

    if (wide){
      ctx.fillStyle = 'rgba(238,241,248,.8)'; ctx.font = '15px Geist, Arial, sans-serif';
      ctx.fillText('A lost wallet key, suspicious activity, or something unexpected', 28, 40);
      ctx.fillStyle = '#EEF1F8'; ctx.font = '500 16px Geist, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Your switch', BASE.x, BASE.y + RING + 30); ctx.textAlign = 'left';
      ctx.fillStyle = '#EEF1F8'; ctx.font = '28px "Instrument Serif", Georgia, serif'; ctx.textAlign = 'center';
      ctx.globalAlpha = grow; ctx.fillText('Peace of mind', 600, 56); ctx.globalAlpha = 1; ctx.textAlign = 'left';
    }
  }

  /* paint the full tree first, so the scene is never empty */
  try { draw(99, 0); } catch (e) { console.error('scene', e); }
  if (!reduce) {
    let prev = performance.now(), t = 0, ticked = false;
    setTimeout(() => { if (!ticked && !stopped) timer = setInterval(() => frame(performance.now(), true), 33); }, 600);
    function frame(now, fromTimer){
      if (!fromTimer) ticked = true;
      const dt = Math.min(.05, (now - prev)/1000); prev = now;
      if (!stopped){
        t += dt;
        if (growing){ grow = Math.min(1, grow + dt/6.5); if (grow >= 1) growing = false; }
        nextFlash -= dt;
        if (nextFlash <= 0){ bolt = makeBolt(); flash = 1; nextFlash = 4 + rnd()*4; }
        flash = Math.max(0, flash - dt*3);
        try { draw(t, dt); } catch (e) { console.error('scene', e); return; }
      }
      if (!fromTimer && !stopped) raf = requestAnimationFrame(frame);
    }
    frame(prev);
    /* grow from the seed when the scene comes into view, and on request */
    const startGrowth = () => { grow = 0; growing = true; };
    let seen = false;
    if ('IntersectionObserver' in window){
      io = new IntersectionObserver((es, ob) => { if (!seen && es[0].isIntersecting){ seen = true; startGrowth(); ob.disconnect(); } }, {threshold: .35});
      io.observe(cv);
    } else startGrowth();
    replay = startGrowth;
  }


  return {
    stop() { stopped = true; cancelAnimationFrame(raf); clearInterval(timer); io?.disconnect(); removeEventListener('resize', onResize); },
    replay,
  };
}
