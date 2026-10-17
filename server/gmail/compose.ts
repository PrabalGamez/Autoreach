/**
 * Gmail web mode: build links into the person's own Gmail in the browser.
 * Nothing is sent by Autoreach and no Google credentials are stored.
 */
const enc = encodeURIComponent;

/** Opens Gmail's full-screen compose window, already filled in, signed in as `from`. */
export function composeUrl(m: { from: string; to: string; subject: string; body: string }) {
  return `https://mail.google.com/mail/?authuser=${enc(m.from)}&view=cm&fs=1&tf=1&to=${enc(m.to)}&su=${enc(m.subject)}&body=${enc(m.body)}`;
}

/** A Gmail search for mail from any of these addresses. */
export function searchUrl(from: string, senders: string[]) {
  const q = senders.length ? `from:(${senders.join(' OR ')})` : 'in:inbox';
  return `https://mail.google.com/mail/?authuser=${enc(from)}#search/${enc(q)}`;
}
