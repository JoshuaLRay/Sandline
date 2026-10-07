import { mountSupplyReview } from './ui/supplyReview.ts';

const mobile = new URLSearchParams(location.search).has('mobile');
const review = mountSupplyReview(document.body, mobile);
const controls = document.createElement('nav');
controls.setAttribute('aria-label', 'Review fixture controls');
controls.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;z-index:15;display:flex;gap:8px;flex-wrap:wrap;color:#e8dcc8;font:14px system-ui;';
for (let i = 0; i < 5; i++) {
  const button = document.createElement('button'); button.textContent = `Cache ${i + 1}`;
  button.style.cssText = 'min-height:44px;padding:8px;';
  button.addEventListener('click', () => { review.actor.holding = false; review.actor.net.selectSupply('', null); review.room.settle(); review.show(i); });
  controls.append(button);
}
const hint = document.createElement('p'); hint.textContent = mobile
  ? 'Mobile stock/progress viewing. Mobile use awaits the U-145 control decision.'
  : 'Select one item, hold E to use, release to interrupt. Reload this fixture to reset stock.';
hint.style.width = '100%'; controls.append(hint); document.body.append(controls);
addEventListener('keydown', event => { if (!mobile && event.code === 'KeyE') review.actor.holding = true; });
addEventListener('keyup', event => { if (event.code === 'KeyE') review.actor.holding = false; });
addEventListener('blur', () => { review.actor.holding = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden) review.actor.holding = false; });
setInterval(() => review.step(), 1000 / 30);
