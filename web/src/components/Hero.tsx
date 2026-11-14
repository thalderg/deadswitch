import { useEffect, useRef, useState } from 'react';
import { startHero, type Hero as HeroHandle } from './hero-scene';

export function HeroScene() {
  const ref = useRef<HTMLCanvasElement>(null);
  const hero = useRef<HeroHandle | null>(null);
  const [canReplay, setCanReplay] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    hero.current = startHero(ref.current, reduce);
    setCanReplay(!!hero.current.replay);
    return () => hero.current?.stop();
  }, []);

  return (
    <figure className="scene">
      <canvas ref={ref} width={1100} height={460} role="img"
        aria-label="On the left, restless wires, one for each coin you hold: Bitcoin, Ethereum, NEAR, USDC, USDT, Solana, Zcash and any NEAR Intents asset, with an occasional flash. They run into a seed inside a pot shaped like the power symbol: your switch. A bonsai grows from it under a soft light. One branch splits into three twigs for Anna 50%, Marco 30% and a cause you care about 20%, if you stop checking in. Another leads to your backup wallet, if you lose access to yours. A low branch sends everything to safety now, if someone gets hold of your keys." />
      <figcaption>
        <span><b>Whatever happens, your plan holds.</b> A lost wallet key, suspicious activity, or something unexpected.</span>
        {canReplay && <button type="button" className="btn secondary small" onClick={() => hero.current?.replay?.()}>Watch it grow again</button>}
        <span className="heir-legend"><span>Anna 50%</span><span>Marco 30%</span><span>A cause you care about 20%</span><span>Your backup wallet</span><span>Sent to safety, now</span></span>
      </figcaption>
    </figure>
  );
}
