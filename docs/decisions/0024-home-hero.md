# 0024: Home hero with "Release on mainnet" first and a small animation

Date: 2026-11-20. Status: accepted.

## Context

The first screen of Home said what the site does and offered one action: run a trade in the simulator. The public
demo escrow on mainnet (decisions 0020 and 0021), the one thing a visitor can do on the real chain without a
wallet, sat below the stats strip and the judges' list, off the first screen on a phone. The illustration showed a
locked box but not what moves, and not the dispute path.

## Decision

1. `web/ui/Hero.tsx` holds the first screen: one sentence of at most 14 words (`home.title`, English and Malay), a
   short note that a paid escrow is waiting on mainnet, the primary button "Release on mainnet" and the simulator
   as a second, plain button under or beside it. The longer explanation moves into "How it works".
2. Pressing "Release on mainnet" opens the demo card in its place. The card and the SolidCash SDK chunk are loaded
   only then, so the first screen carries no SDK. The card reads the escrow from the chain and shows its own
   button: the first press never broadcasts, the visitor sees the escrow state and what the second press sends.
   Keyboard focus moves to the card because the button that opened it is gone. The card no longer appears lower on
   the page.
3. `HeroArt` shows a coin leaving the seller, waiting in the contract and going on to the buyer, and a dispute
   branch drawing down to a panel of three where two votes light up. The keyframes (`hero-*` in `web/styles.css`)
   change only `transform`, `opacity` and `stroke-dashoffset`: an animated blur or backdrop filter crashes WebKit.
   Animations start only inside `prefers-reduced-motion: no-preference`; otherwise the frame is still, with the
   coin in the contract and the dispute branch drawn.
4. Tests: `tests/hero.test.ts` checks the sentence length in both languages, the animated properties and the
   reduced-motion guard (with cases that must fail). `e2e/hero.spec.ts` checks, on WebKit iPhone 13 and on
   Chromium at 1280 x 800, that the bottom of "Release on mainnet" is at most 664 px from the top, that the
   simulator button follows it, that the rendered SVG is at most 8 KB, that the opened card takes focus and offers
   only the dry release (`?demo=dry`), that the animation stops with reduced motion, and that nothing is wider
   than 320 px. No test presses the live button.

## Consequences

- Two presses release the demo escrow instead of one. The first costs nothing and shows what will be sent.
- Tests that used the demo card open it from the hero first (`e2e/demo.spec.ts`).
- Undo: restore `web/ui/Home.tsx`, `web/ui/Art.tsx` and the `home.*` keys from the commit before this one.
