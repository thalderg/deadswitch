# Deadswitch: 2-minute demo video

Real mainnet transactions throughout. Voice-over in quotes; what's on screen in brackets. About 280 words of voice-over, which fits 2:00 at a calm pace.

## Before recording

1. **The timer run-out is a one-shot.** Once the timer runs out, `deadswitch.thalderg.near` is final: you're locked out of it for good, and the service sends everything (0.5 wNEAR, about 0.1 SOL and 0.0018 ETH) to Anna (60%) and Marco (40%). So record shots 1–5 first (as many takes as you like), and shot 6 once, at the end.
2. **10-minute timer** (owner transaction, counts as a check-in):
   `near call deadswitch.thalderg.near set_timeout '{"timeout_secs":600}' --useAccount thalderg.near --networkId mainnet`
3. **Demo reminders:** in `service/.env`, `DEMO_REMINDER_OFFSETS_SECONDS=300,120`, then restart the service. Reminders arrive 5 and 2 minutes before the deadline.
4. **Heir notification:** on the dashboard, turn on "Tell the people in my plan when it runs" and give Anna's contact as your own email (Resend's test sender only delivers there) or as a Telegram @username that has pressed Start in the bot.
5. Open in tabs: the landing page, `/plan`, `/heir`, Telegram, your inbox, and the service log in a terminal. Before the run-out, film `/heir` once: it shows what each person holds now (Anna 0.14 NEAR, Marco 0.06 NEAR) and what they would receive.
6. The panic button setting should be on (it was waiting to turn on). Don't press **Send everything** in the video: open the dialog and press **Keep my funds**.

## Script

**0:00–0:15 · The problem** [Landing page; the bonsai grows from the seed]
"In crypto, your capital is at risk every day. Keys leak, people get pressured, wallets get lost, and when someone dies their coins are often gone. Deadswitch gives your crypto a plan."

**0:15–0:35 · How it works** [Scroll to the hero, point at the wires, the power-symbol pot, the branches]
"Your funds stay in your own NEAR Intents account: Bitcoin, Ethereum, NEAR, stablecoins. You give the switch one permission, a key nobody holds: only NEAR's MPC network can sign with it, and only when the contract's rules allow."

**0:35–0:55 · Your plan** [Dashboard: countdown, the bar, "Everything is in place", who receives what]
"This is my plan. Anna gets 60 percent, Marco 40, of everything: NEAR, Solana and Ethereum alike. The timer shows how long until it runs. For the demo it's 10 minutes; in real life, months. Any change that adds power waits two days and can be cancelled."

**0:55–1:05 · The panic button** [Open "Send everything to your plan?", read it, press "Keep my funds"]
"If my keys are ever exposed, one button sends everything to the people in my plan before anyone else can take it."

**1:05–1:25 · A reminder** [Telegram and the email arrive; tap "I'm still here"; the bot replies; switch to the dashboard: "from a Telegram reminder", the bar back to zero]
"Before the timer runs out, a reminder arrives by Telegram and email. One tap, and I'm checked in. No wallet, no signature, no fee: the service pays the network fee, and it can do nothing except reset my timer."

**1:25–1:45 · When nobody answers** [Cut ahead 10 minutes. Dashboard: "Your plan has run". Service log: the sweep transaction]
"Now imagine I don't answer. The timer runs out, the switch triggers, and the plan is carried out: the contract writes one transfer, has it signed by the MPC network, and sends it through NEAR Intents."

**1:45–1:55 · The people in the plan** [The `/heir` page: "In their NEAR Intents account now" has grown (before: Anna 0.14 NEAR); click a transfer link to nearblocks; the notification email]
"Anna and Marco receive their shares in their own accounts, NEAR, Solana and Ethereum alike, with a message explaining how to withdraw. Every transfer is on-chain."

**1:55–2:00 · Close** [Landing page, "Free during the beta"]
"Deadswitch. Peace of mind now, and an impact that outlasts you. Built on NEAR Intents and Chain Signatures."
