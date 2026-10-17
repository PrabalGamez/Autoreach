import { z } from 'zod';

export const VoiceSchema = z.object({
  tone: z.string(),
  typical_length: z.string(),
  greeting: z.string(),
  signoff: z.string(),
  traits: z.array(z.string()).max(8),
  avoid: z.array(z.string()).max(8),
});
export type Voice = z.infer<typeof VoiceSchema>;

const Route = z.enum(['email', 'form_only']);
const Kind = z.enum(['company', 'brand', 'person', 'other']);

export const ProposalSchema = z.object({
  proposals: z
    .array(
      z.object({
        name: z.string(),
        kind: Kind,
        domain: z.string().nullable(),
        contact_email: z.string().nullable(),
        contact_source_url: z.string().nullable(),
        route: Route,
        form_url: z.string().nullable(),
        why_fit: z.string(),
        sources: z.array(z.string()).min(1),
      }),
    )
    .max(25),
});
export type Proposal = z.infer<typeof ProposalSchema>['proposals'][number];

export const BriefSchema = z.object({
  summary: z.string(),
  aesthetic: z.string(),
  recent: z.array(z.string()).max(6),
  favourites: z.array(z.object({ title: z.string(), url: z.string().nullable(), why: z.string() })).min(1).max(3),
  possible_deals: z
    .array(z.object({ type: z.string(), confidence: z.enum(['low', 'medium', 'high']), reason: z.string() }))
    .min(1)
    .max(4),
  submission_rules: z.string(),
  red_flags: z.array(z.string()).max(6),
  sources: z.array(z.string()).min(1).max(10),
  contact: z.object({
    route: Route,
    contact_email: z.string().nullable(),
    contact_source_url: z.string().nullable(),
    form_url: z.string().nullable(),
    timezone: z.string().nullable(),
  }),
});
export type Brief = z.infer<typeof BriefSchema>;

export const DraftSchema = z.object({
  subject: z.string().min(3).max(120),
  body: z.string().min(20),
  unique_reference: z.string().min(3),
  link_used: z.string().nullable(),
});
export type DraftOut = z.infer<typeof DraftSchema>;

export const ClassifySchema = z.object({
  label: z.enum(['offer', 'interested', 'decline', 'auto_reply', 'other', 'opt_out']),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  terms: z.object({
    money: z.string().nullable(),
    rights: z.string().nullable(),
    term_length: z.string().nullable(),
    exclusivity: z.string().nullable(),
    other: z.array(z.string()),
  }),
  questions: z.array(z.string()).max(8),
});
export type Classification = z.infer<typeof ClassifySchema>;

export const IntroMatchSchema = z.object({
  suggestions: z
    .array(z.object({ person_id: z.number().int(), target_id: z.number().int(), reason: z.string(), confidence: z.enum(['low', 'medium', 'high']) }))
    .max(30),
});

export const ProfileContextSchema = z.object({
  summary: z.string(),
  style: z.string(),
  audience_stage: z.enum(['just starting', 'emerging', 'growing', 'established']),
  audience_reason: z.string(),
  work: z.array(z.object({ title: z.string(), url: z.string().nullable(), year: z.string().nullable(), note: z.string() })).max(12),
  platforms: z.array(z.object({ platform: z.string(), url: z.string(), followers: z.string().nullable(), note: z.string() })).max(10),
  peers: z.array(z.string()).max(10),
  strengths: z.array(z.string()).max(6),
  gaps: z.array(z.string()).max(6),
  fit: z
    .array(z.object({ tier: z.enum(['reach', 'realistic', 'stepping stone']), examples: z.array(z.string()).max(6), why: z.string() }))
    .max(3),
  facts_to_use: z.array(z.string()).max(10),
  uncertain: z.array(z.string()).max(8),
  sources: z.array(z.string()).max(15),
});
