"""Builds docs/demo/deadswitch-demo.mp4: a silent, captioned walkthrough from the demo screenshots.

Run from the repo root: python3 docs/demo/make_video.py   (needs Pillow and ffmpeg)
"""
import os, subprocess, tempfile
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, '..', 'screenshots')
W, H, CAP = 1920, 1080, 190
NIGHT, MOON, MIST, TIDE = (5, 7, 13), (238, 241, 248), (167, 177, 200), (127, 209, 193)

def font(names, size):
    for n in names:
        try: return ImageFont.truetype(n, size)
        except OSError: pass
    return ImageFont.load_default()

SERIF = lambda s: font(['/System/Library/Fonts/Supplemental/Georgia.ttf', 'Georgia.ttf'], s)
SANS = lambda s: font(['/System/Library/Fonts/HelveticaNeue.ttc', '/System/Library/Fonts/Helvetica.ttc'], s)

def wrap(draw, text, f, width):
    lines, line = [], ''
    for word in text.split():
        t = (line + ' ' + word).strip()
        if draw.textlength(t, font=f) <= width: line = t
        else: lines.append(line); line = word
    return lines + [line]

def card(title, sub=''):
    im = Image.new('RGB', (W, H), NIGHT)
    d = ImageDraw.Draw(im)
    tf, sf = SERIF(96), SANS(40)
    d.text((W / 2, H / 2 - (40 if sub else 0)), title, font=tf, fill=MOON, anchor='mm')
    for i, line in enumerate(wrap(d, sub, sf, 1400) if sub else []):
        d.text((W / 2, H / 2 + 60 + i * 54), line, font=sf, fill=MIST, anchor='mm')
    return im

def stats():
    """Opening card: what is at risk, with sources."""
    im = Image.new('RGB', (W, H), NIGHT)
    d = ImageDraw.Draw(im)
    d.text((W / 2, 170), 'In crypto, your capital is at risk every day.', font=SERIF(72), fill=MOON, anchor='mm')
    for x, big, small in [(W / 2 - 430, '$13 billion+', 'stolen in crypto hacks, 2021–2025'), (W / 2 + 430, '2.3–3.7 million BTC', 'lost for good: keys lost, forgotten, or gone with their owner')]:
        d.text((x, 470), big, font=SERIF(96), fill=TIDE, anchor='mm')
        for i, line in enumerate(wrap(d, small, SANS(38), 700)):
            d.text((x, 570 + i * 50), line, font=SANS(38), fill=MIST, anchor='mm')
    d.text((W / 2, 900), 'Sources: Chainalysis theft reports 2024–2025; Chainalysis estimate via Ledger Academy.', font=SANS(28), fill=MIST, anchor='mm')
    return im

def columns():
    """Peace of mind now. An impact that outlasts you."""
    im = Image.new('RGB', (W, H), NIGHT)
    d = ImageDraw.Draw(im)
    d.text((W / 2, 140), 'Peace of mind now. An impact that outlasts you.', font=SERIF(68), fill=MOON, anchor='mm')
    cols = [('While you’re here', ['Use your funds as you always do: trading, swapping and withdrawing keep working.', 'Reminders by email or Telegram. One tap checks you in: no wallet, no fees.', 'If your keys are ever at risk, one button moves everything to safety.']),
            ('When you’re gone', ['Everything goes where you want: family, friends, or a cause you care about.', 'Each person receives their share in their own account, ready to withdraw.', 'Your crypto keeps doing good after you, instead of being lost forever.'])]
    for c, (title, items) in enumerate(cols):
        x0 = 160 + c * 840
        d.rounded_rectangle((x0, 260, x0 + 760, 960), radius=36, fill=(16, 24, 36), outline=(40, 70, 72), width=2)
        d.text((x0 + 50, 330), title, font=SERIF(58), fill=MOON, anchor='lm')
        y = 430
        for item in items:
            d.ellipse((x0 + 52, y + 10, x0 + 64, y + 22), fill=TIDE)
            lines = wrap(d, item, SANS(34), 600)
            for i, line in enumerate(lines):
                d.text((x0 + 90, y + i * 46), line, font=SANS(34), fill=MIST, anchor='lt')
            y += len(lines) * 46 + 50
    return im

def steps(title, items):
    """A title and numbered steps."""
    im = Image.new('RGB', (W, H), NIGHT)
    d = ImageDraw.Draw(im)
    d.text((W / 2, 150), title, font=SERIF(76), fill=MOON, anchor='mm')
    y = 300
    for n, text in items:
        d.text((300, y), n, font=SERIF(64), fill=TIDE, anchor='mm')
        for i, line in enumerate(wrap(d, text, SANS(40), 1300)):
            d.text((380, y - 20 + i * 52), line, font=SANS(40), fill=MOON, anchor='lm')
        y += 175
    return im

def roadmap():
    """The "What's next" card: a title and a short list."""
    im = Image.new('RGB', (W, H), NIGHT)
    d = ImageDraw.Draw(im)
    d.text((W / 2, 150), 'What’s next', font=SERIF(84), fill=MOON, anchor='mm')
    items = [
        ('Confidential by default', 'near.com keeps balances confidential by default; the switch will protect them and pay out privately.'),
        ('A testament per asset and amount', '“Anna gets the BTC, Marco 2,000 USDC, the rest to a charity.”'),
        ('A private testament', 'Only a hash on-chain, unlocked when the switch triggers.'),
        ('Straight to their own wallets', 'Payouts on Bitcoin, Ethereum or Solana, converted if they want.'),
    ]
    y = 290
    for title, text in items:
        d.ellipse((260, y - 9, 278, y + 9), fill=TIDE)
        d.text((310, y), title, font=SANS(44), fill=MOON, anchor='lm')
        d.text((310, y + 56), text, font=SANS(34), fill=MIST, anchor='lm')
        y += 170
    return im

def slide(path, caption, crop=None):
    shot = Image.open(path).convert('RGB')
    if crop: shot = shot.crop(crop)
    area_w, area_h = W - 120, H - CAP - 60
    shot.thumbnail((area_w, area_h), Image.LANCZOS)
    im = Image.new('RGB', (W, H), NIGHT)
    im.paste(shot, ((W - shot.width) // 2, 30 + (area_h - shot.height) // 2))
    d = ImageDraw.Draw(im)
    d.rectangle((0, H - CAP, W, H), fill=(10, 14, 26))
    d.line((0, H - CAP, W, H - CAP), fill=(35, 46, 72), width=2)
    f = SANS(40)
    lines = wrap(d, caption, f, W - 240)
    y0 = H - CAP / 2 - (len(lines) - 1) * 26
    for i, line in enumerate(lines):
        d.text((W / 2, y0 + i * 52), line, font=f, fill=MOON, anchor='mm')
    return im

d = lambda n: os.path.join(HERE, n)
s = lambda n: os.path.join(SHOTS, n)

SLIDES = [
    (stats(), 8),
    (card('Deadswitch', 'A plan for your crypto, on NEAR Intents. A real run on NEAR mainnet.'), 4),
    (columns(), 9),
    (slide(d('01-landing.png'), 'Your funds stay in your own NEAR Intents account. If anything happens to you or your keys, everything goes exactly where you chose.', (0, 0, 1440, 640)), 6),
    (slide(d('01-landing.png'), 'Every coin you hold flows into one switch. From it grows your plan: the people you chose, a backup wallet, or safety if your keys leak.', (200, 625, 1440, 1235)), 7),
    (slide(d('03-plan-before.png'), 'The owner’s dashboard: 0.5 NEAR, 0.1 SOL and 0.0019 ETH in NEAR Intents. Anna gets 60%, Marco 40%. Everything is in place.'), 7),
    (slide(s('reminder-telegram.png'), 'Before the timer runs out, a reminder arrives on Telegram. One tap on “I’m still here” checks you in: no wallet, no signature, no fee.'), 6),
    (slide(s('reminder-email.png'), 'The same reminder arrives by email. The check-in is paid by the reminder service, which can do nothing except reset your timer.'), 6),
    (slide(s('plan-change-pending.png'), 'Changes that add power wait (48 hours in real use) and can be cancelled. Turning something off applies at once.'), 5),
    (slide(d('02-heir-before.png'), 'What Anna and Marco would receive today. Right now their own accounts hold 0.14 and 0.06 NEAR.'), 6),
    (slide(d('04-plan-countdown.png'), 'For the demo, the timer is set to 10 minutes. Now nobody checks in.'), 5),
    (card('10 minutes later…', 'No check-in. The reminders went unanswered.'), 3),
    (slide(d('05-plan-has-run.png'), 'The switch triggers. The reminder service carries out the plan on its own: one transfer per asset, signed by NEAR’s MPC network with a key nobody holds.'), 7),
    (slide(d('06-heir-after.png'), 'Anna and Marco received their shares, NEAR, Solana and Ethereum, straight into their own NEAR Intents accounts.'), 7),
    (steps('How it moved without anyone signing', [
        ('1', 'The reminder service asks the contract to carry out the plan. It can’t choose where the money goes.'),
        ('2', 'The contract writes the payment itself, from the plan: 60% to Anna, 40% to Marco.'),
        ('3', 'NEAR’s MPC network signs it together. The full key never exists anywhere.'),
        ('4', 'NEAR Intents checks the key the owner registered and moves NEAR, SOL and ETH alike.'),
    ]), 10),
    (slide(d('07-explorer.png'), 'Every transfer is public on NEAR mainnet: Chain Signatures, the intent, the token transfers. Nothing passed through the contract.'), 6),
    (roadmap(), 9),
    (card('Deadswitch', 'Peace of mind now, an impact that outlasts you. Built on NEAR Intents and Chain Signatures. A prototype, not a legal will.'), 5),
]

def main():
    tmp = tempfile.mkdtemp()
    files, durs = [], []
    for i, (im, dur) in enumerate(SLIDES):
        p = os.path.join(tmp, f'{i:02d}.png'); im.save(p); files.append(p); durs.append(dur)
    fade = 0.6
    args = ['ffmpeg', '-y', '-loglevel', 'error']
    for p, dur in zip(files, durs): args += ['-loop', '1', '-t', str(dur), '-i', p]
    chain, last, offset = [], '[0:v]', 0.0
    for i in range(1, len(files)):
        offset += durs[i - 1] - fade
        out = f'[v{i}]'
        chain.append(f'{last}[{i}:v]xfade=transition=fade:duration={fade}:offset={offset:.2f}{out}')
        last = out
    chain.append(f'{last}format=yuv420p[out]')
    args += ['-filter_complex', ';'.join(chain), '-map', '[out]', '-r', '30', '-c:v', 'libx264', '-crf', '20', '-movflags', '+faststart', os.path.join(HERE, 'deadswitch-demo.mp4')]
    subprocess.run(args, check=True)
    print('wrote', os.path.join(HERE, 'deadswitch-demo.mp4'), f'({sum(durs) - fade * (len(durs) - 1):.0f} s)')

if __name__ == '__main__':
    main()
