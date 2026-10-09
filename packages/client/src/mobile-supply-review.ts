import { mountMobileSupplyReview } from './ui/mobileSupplyReview.ts';

const review = mountMobileSupplyReview(document.body);
const controls = document.createElement('div');
controls.style.cssText = 'position:fixed;z-index:27;top:calc(max(12px,env(safe-area-inset-top)) + 58px);left:50%;transform:translateX(-50%);width:110px;color:#fff1db;font:12px system-ui;';
const toggle = document.createElement('button'); toggle.textContent = 'Review setup';
toggle.style.cssText = 'min-height:48px;width:100%;background:#18201a;color:inherit;border:1px solid #73826b;border-radius:8px;';
const setup = document.createElement('div'); setup.hidden = true;
setup.style.cssText = 'position:absolute;top:58px;left:50%;transform:translateX(-50%);width:calc(100vw - 52px);max-height:45dvh;overflow:auto;background:#18201af5;padding:10px;border-radius:8px;';
const hint = document.createElement('p');
hint.textContent = 'Isolated authored-floor fixture; bots are placed beside the chosen cache to review collection. The clock, inventory and stock run through Session and the phone controls. Watching a human grants no use authority. Reload to reset stock.';
setup.append(hint);
for (const [label, action] of [
  ['South cache', () => review.show(0)], ['Ridge cache', () => review.show(2)],
  ['Basement cache', () => review.show(3)], ['Outpost cache', () => review.show(4)], ['Last kit contention', () => {
    review.show(1); review.desktop.net.selectSupply('P-ROAD', { kind: 'health-kit' }); review.desktop.holding = true; review.room.settle();
  }], ['Cancel desktop hold', () => { review.desktop.holding = false; }],
  ['Reconnect commander', () => { review.choice.set(null); review.room.reconnect(review.commander); review.commander.net.spectate(3); review.room.settle(); review.refresh(); }],
] as const) {
  const button = document.createElement('button'); button.textContent = label;
  button.style.cssText = 'min-height:44px;margin:4px;color:inherit;background:#35412f;border:1px solid #73826b;border-radius:8px;';
  button.addEventListener('click', () => { review.choice.cancel(); action(); setup.hidden = true; }); setup.append(button);
}
toggle.addEventListener('click', () => { review.choice.cancel(); setup.hidden = !setup.hidden; });
review.choice.root.addEventListener('click', () => { setup.hidden = true; });
controls.append(toggle, setup); document.body.append(controls);
setInterval(() => review.step(), 1000 / 30);
