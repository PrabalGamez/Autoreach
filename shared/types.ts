export type TargetStatus =
  | 'proposed'
  | 'researching'
  | 'draft_ready'
  | 'approved'
  | 'sent'
  | 'replied'
  | 'offer'
  | 'closed'
  | 'declined'
  | 'rejected';

export const PIPELINE_STATUSES: TargetStatus[] = [
  'researching',
  'draft_ready',
  'approved',
  'sent',
  'replied',
  'offer',
  'closed',
  'declined',
];

export interface LinkItem {
  label: string;
  url: string;
}
export interface Work {
  title: string;
  url: string;
  note: string;
}

export interface Profile {
  alias: string;
  real_name: string;
  pitch: string;
  niches: string[];
  links: LinkItem[];
  best_works: Work[];
  goals: string[];
  voice_samples: string[];
  voice_profile: {
    tone: string;
    typical_length: string;
    greeting: string;
    signoff: string;
    traits: string[];
    avoid: string[];
  } | null;
  sender_email: string | null;
  postal_address: string;
  artist_context: ArtistContext | null;
  context_at: string | null;
  context_skipped_at: string | null;
  onboarded_at: string | null;
}

/** Claude's research on the artist, built once after login + profile. */
export interface ArtistContext {
  summary: string;
  sound: string;
  audience_stage: 'just starting' | 'emerging' | 'growing' | 'established';
  audience_reason: string;
  releases: { title: string; url: string | null; year: string | null; note: string }[];
  platforms: { platform: string; url: string; followers: string | null; note: string }[];
  similar_artists: string[];
  strengths: string[];
  gaps: string[];
  label_fit: { tier: 'reach' | 'realistic' | 'stepping stone'; examples: string[]; why: string }[];
  facts_to_use: string[];
  uncertain: string[];
  sources: string[];
}

export interface ContextJob {
  status: 'idle' | 'running' | 'done' | 'failed';
  startedAt: string | null;
  finishedAt: string | null;
  activity: { kind: 'search' | 'fetch' | 'tool'; text: string; at: string }[];
  error: string | null;
}

export interface Target {
  id: number;
  name: string;
  kind: 'label' | 'brand' | 'collaborator' | 'other';
  domain: string | null;
  contact_email: string | null;
  contact_source_url: string | null;
  route: 'email' | 'form_only';
  form_url: string | null;
  timezone: string | null;
  referred_by: number | null;
  referrer_name?: string | null;
  origin: 'ai' | 'csv' | 'manual';
  why_fit: string;
  proposal_sources: string[];
  status: TargetStatus;
  notes: string;
  created_at: string;
  updated_at: string;
  suppressed?: boolean;
}

export interface Brief {
  summary: string;
  aesthetic: string;
  recent: string[];
  favourites: { title: string; url: string | null; why: string }[];
  possible_deals: { type: string; confidence: 'low' | 'medium' | 'high'; reason: string }[];
  submission_rules: string;
  red_flags: string[];
  sources: string[];
  researched_at: string;
}

export interface Draft {
  id: number;
  target_id: number | null;
  person_id: number | null;
  kind: 'initial' | 'followup' | 'intro_request' | 'reply';
  subject: string;
  body: string;
  unique_reference: string;
  version: number;
  regen_note: string | null;
  link_used: string | null;
  state: 'pending' | 'approved' | 'skipped' | 'discarded' | 'queued' | 'sent' | 'failed' | 'submitted_form';
  approved_at: string | null;
  created_at: string;
}

export interface ReviewCard {
  draft: Draft;
  target: Target | null;
  brief: Brief | null;
  person: Person | null;
  to: string | null;
}

export interface Person {
  id: number;
  name: string;
  email: string | null;
  relationship: string;
  notes: string;
}

export interface Terms {
  money: string | null;
  rights: string | null;
  term_length: string | null;
  exclusivity: string | null;
  other: string[];
}

export interface OfferAlert {
  id: number;
  reply_id: number;
  target_id: number | null;
  target_name: string | null;
  from_email: string | null;
  summary: string | null;
  confidence: number | null;
  terms: Terms | null;
  questions: string[];
  thread_id: string;
  body: string;
  received_at: string | null;
  acknowledged_at: string | null;
  handled_at: string | null;
  created_at: string;
}

export interface Health {
  claude: {
    ok: boolean;
    installed: boolean;
    loggedIn: boolean;
    version: string | null;
    error: string | null;
    checkedAt: string;
  } | null;
  gmail: { connected: boolean; email: string | null; hasClient: boolean; error: string | null; mode: 'gmail_web' | 'gmail_api' };
  paused: { paused: boolean; reason: string | null; since: string | null };
  onboarded: boolean;
  claudeCheck: { checking: boolean; stage: 'idle' | 'finding' | 'signing_in'; version: string | null };
  profileComplete: boolean;
  /** The "ifContext" switch: true once Claude has researched the artist, so the context screen is skipped. */
  hasContext: boolean;
  contextSkipped: boolean;
  contextJob: ContextJob;
  jobs: { running: number; waiting: number };
  pendingOffers: number;
  queue: { queued: number; sentToday: number; cap: number; nextSendAt: string | null };
  fakeGmail: boolean;
}
