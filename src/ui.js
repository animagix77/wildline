/* Dependency-free UI helpers so gameplay modules can talk to the player. */
const host = () => document.getElementById('toasts');

export function toast(msg, kind = '') {
  const h = host();
  if (!h) return;
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  h.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .4s'; el.style.opacity = '0';
    setTimeout(() => el.remove(), 420);
  }, 3200);
  while (h.children.length > 5) h.firstChild.remove();
}
