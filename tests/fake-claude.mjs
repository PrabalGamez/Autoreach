#!/usr/bin/env node
// Stand-in for the `claude` CLI in tests and demo mode. Reads the --json-schema
// to decide which task is being asked for and returns plausible structured output.
import fs from 'node:fs';

const args = process.argv.slice(2);
const mode = process.env.FAKE_CLAUDE_MODE ?? 'ok';
if (args.includes('--version')) {
  if (mode === 'missing') process.exit(127);
  console.log('2.1.241 (Claude Code)');
  process.exit(0);
}

const stdin = fs.readFileSync(0, 'utf8');
const schemaArg = args[args.indexOf('--json-schema') + 1] ?? '{}';
const props = Object.keys(JSON.parse(schemaArg).properties ?? {});
const log = process.env.FAKE_CLAUDE_LOG;
if (log) fs.appendFileSync(log, JSON.stringify({ args, props, stdin: stdin.slice(0, 4000) }) + '\n');

const out = (structured) => {
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(structured), structured_output: structured, total_cost_usd: 0.001 }));
  process.exit(0);
};

if (mode === 'nologin') {
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login', total_cost_usd: 0 }));
  process.exit(1);
}

const field = (name) => (stdin.match(new RegExp(`^${name}: (.+)$`, 'm')) ?? [])[1]?.trim() ?? 'Unknown';
const delay = Number(process.env.FAKE_CLAUDE_DELAY_MS ?? 0);
if (delay) await new Promise((r) => setTimeout(r, delay));

if (props.includes('ok')) out({ ok: true });

if (props.includes('typical_length'))
  out({ tone: 'warm, direct, a little dry', typical_length: '80-120 words', greeting: 'Hey {name},', signoff: 'Cheers, Prabal', traits: ['short paragraphs', 'one specific compliment', 'ends with a question'], avoid: ['exclamation marks', 'buzzwords'] });

if (props.includes('proposals'))
  out({
    proposals: [
      { name: 'Sample Bass Label A', kind: 'label', domain: 'samplebass-a.test', contact_email: 'demos@samplebass-a.test', contact_source_url: 'https://samplebass-a.test/contact', route: 'email', form_url: null, why_fit: 'Releases heavy 150 BPM dubstep from new producers.', sources: ['https://samplebass-a.test'] },
      { name: 'Sample Riddim Label B', kind: 'label', domain: 'riddim-b.test', contact_email: null, contact_source_url: null, route: 'form_only', form_url: 'https://www.labelradar.com/labels/riddim-b', why_fit: 'Riddim-leaning label that only takes LabelRadar demos.', sources: ['https://riddim-b.test/demos'] },
    ],
  });

if (props.includes('favourites')) {
  const name = field('Target');
  out({
    summary: `${name} is an independent bass music label releasing singles and EPs from emerging producers.`,
    aesthetic: 'Dark, metallic sound design with half-time drums and big call-and-response drops.',
    recent: ['Sample single "Ironclad" (Sep 2026)', 'Sample EP "Undertow" (Jul 2026)'],
    favourites: [
      { title: `"Ironclad" on ${name}`, url: null, why: 'Same growl-bass palette as the sender' },
      { title: 'Their riddim compilation', url: null, why: 'Shows they sign first-time artists' },
    ],
    possible_deals: [
      { type: 'single release', confidence: 'high', reason: 'Most of their catalogue is singles' },
      { type: 'EP', confidence: 'low', reason: 'EPs go to established artists' },
    ],
    submission_rules: 'Private SoundCloud link to the demo email, unreleased tracks only.',
    red_flags: [],
    sources: ['https://example.test/label'],
    contact: { route: 'email', contact_email: null, contact_source_url: null, form_url: null, timezone: 'America/Los_Angeles' },
  });
}

if (props.includes('unique_reference')) {
  const name = field('Recipient').replace(/ \(.*$/, '');
  const ref = `the drop on "Ironclad" for ${name}`;
  const note = (stdin.match(/Sender's note: "([^"]+)"/) ?? [])[1];
  const warm = /WARM intro: (.+?) suggested/.exec(stdin);
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  if (/too similar/.test(stdin)) h += 1 + Math.floor(Math.random() * 4);
  const link = 'https://soundcloud.com/sample/private';
  const bodies = [
    `Hey ${name} team,\n\nI keep coming back to ${ref}, the bass answering the vocal is the space I write in. I'm Prabal, heavy dubstep at 150 BPM. Would you hear one unreleased track for a possible single?\n\n${link}\n\nCheers,\nPrabal`,
    `Hi ${name},\n\nShort one: ${ref} made me rebuild my own drop from scratch last month. I produce 150 BPM dubstep and finished a track I think sits next to it. Open to a listen?\n\n${link}\n\nThanks,\nPrabal`,
    `Hello ${name},\n\nPrabal here. After hearing ${ref} I wanted to send you something specific rather than a playlist. One unreleased heavy track, mastered, stems ready. Is your demo inbox the right place?\n\n${link}\n\nBest,\nPrabal`,
    `${name} folks,\n\nMy question is simple. Does ${ref} mean you are signing more metallic, half-time stuff this year? If so I have a finished 150 BPM single that fits.\n\n${link}\n\nPrabal`,
    `Hey ${name},\n\nWriting because ${ref} is the reference track pinned in my project folder. I make heavy dubstep and just wrapped a single built around a similar call-and-response idea. Worth a spin?\n\n${link}\n\nCheers, Prabal`,
  ];
  out({
    subject: `Heavy 150 BPM demo for ${name}`,
    body: `${warm ? `${warm[1]} suggested I reach out. ` : ''}${bodies[h % bodies.length]}${note ? `\n(${note})` : ''}`,
    unique_reference: ref,
    link_used: link,
  });
}

if (props.includes('label')) {
  const text = stdin.toLowerCase();
  if (/contract|advance|royalt|offer|\$\d|usd|inr/.test(text))
    out({ label: 'offer', confidence: 0.92, summary: 'Offers a single release with an advance and a royalty split.', terms: { money: '$500 advance, 50/50 net royalties', rights: 'Master rights for 5 years', term_length: '5 years', exclusivity: 'Exclusive worldwide', other: ['Release in December'] }, questions: ['Does the advance recoup against royalties?', 'Do rights revert after 5 years?'] });
  if (/out of office|ooo|away until/.test(text)) out({ label: 'auto_reply', confidence: 0.95, summary: 'Out of office.', terms: { money: null, rights: null, term_length: null, exclusivity: null, other: [] }, questions: [] });
  if (/not a fit|pass|no thanks/.test(text)) out({ label: 'decline', confidence: 0.9, summary: 'They passed on the track.', terms: { money: null, rights: null, term_length: null, exclusivity: null, other: [] }, questions: [] });
  out({ label: 'interested', confidence: 0.8, summary: 'Wants to hear more tracks.', terms: { money: null, rights: null, term_length: null, exclusivity: null, other: [] }, questions: [] });
}

if (props.includes('suggestions')) {
  const tIdx = stdin.indexOf('Targets:');
  const ps = [...stdin.slice(0, tIdx).matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1]));
  const ts = [...stdin.slice(tIdx).matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1]));
  out({ suggestions: ps.length && ts.length ? [{ person_id: ps[0], target_id: ts[0], reason: 'Played on the same bill as their A&R last year', confidence: 'medium' }] : [] });
}

console.log(JSON.stringify({ type: 'result', is_error: true, result: `fake-claude: unknown task (${props.join(',')})` }));
process.exit(1);
