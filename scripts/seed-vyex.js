#!/usr/bin/env node
/**
 * One-time seed: writes 5 free experts to data/experts.json for VyEx.
 * Run: node scripts/seed-vyex.js
 * If data/experts.json already has entries, this script does not overwrite (exit 0).
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const EXPERTS_PATH = join(DATA_DIR, 'experts.json');

const SEED_EXPERTS = [
  {
    id: 'xero-invoice-processing',
    name: 'Xero Invoice Processing Expert',
    category: 'Accounting',
    description: 'Base knowledge for processing and reconciling Xero invoices. Rules for coding, approval workflows, and export.',
    full_description: 'This expert provides Vy with structured knowledge for working inside Xero: how to interpret invoice fields, match to purchase orders, apply coding rules, and run approval workflows. Use it when your workflow involves processing supplier invoices or preparing them for export.',
    use_cases: ['Code incoming invoices by account', 'Match invoices to POs', 'Export paid invoices for month-end'],
    tags: ['xero', 'invoicing', 'accounting', 'reconciliation'],
    author: 'texflow',
    price: 0,
    paid: false,
    preamble: 'You are assisting with Xero invoice processing. Key rules: (1) Always match invoices to purchase orders when a PO reference exists. (2) Default coding: use the account from the first line item unless the user specifies otherwise. (3) For approval workflows, check that the total is within the approver\'s limit before suggesting approval. (4) When exporting, include invoice number, date, supplier, total, and status. Never modify or delete invoices without explicit user confirmation.',
    status: 'public',
    created_at: new Date().toISOString()
  },
  {
    id: 'linkedin-outreach',
    name: 'LinkedIn Outreach Expert',
    category: 'Sales',
    description: 'Templates and rules for personalized LinkedIn outreach: connection requests, follow-ups, and reply handling.',
    full_description: 'Curated base knowledge for running LinkedIn outreach with Vy: connection message templates, follow-up sequences, and rules for when to personalize vs use templates. Includes tone guidelines and compliance-friendly phrasing.',
    use_cases: ['Draft connection requests by segment', 'Write follow-up sequences', 'Suggest replies to common responses'],
    tags: ['linkedin', 'sales', 'outreach', 'cold-messaging'],
    author: 'texflow',
    price: 0,
    paid: false,
    preamble: 'You are helping with LinkedIn outreach. Rules: (1) Keep connection requests under 300 characters; lead with a specific reason tied to their profile. (2) Follow-ups: max 2–3 per prospect, spaced at least 3 days apart. (3) Never sound like a bot: use one concrete detail from their profile per message. (4) For replies, mirror their tone and length. (5) Do not make up company names or job titles; only use data the user or their CRM provides.',
    status: 'public',
    created_at: new Date().toISOString()
  },
  {
    id: 'figma-design-qa',
    name: 'Figma Design QA Expert',
    category: 'Design',
    description: 'Checklist and preamble for design QA in Figma: spacing, alignment, typography, and accessibility.',
    full_description: 'Structured knowledge for running design QA workflows in Figma with Vy: spacing and alignment rules, typography scale checks, color contrast, and basic accessibility (focus order, touch targets). Use when reviewing screens before handoff.',
    use_cases: ['Check spacing and alignment consistency', 'Verify typography scale', 'Run accessibility checklist'],
    tags: ['figma', 'design', 'qa', 'accessibility'],
    author: 'texflow',
    price: 0,
    paid: false,
    preamble: 'You are assisting with Figma design QA. Checklist: (1) Spacing: use 4px or 8px grid; flag any odd values. (2) Alignment: elements in a row/column should share a clear alignment line. (3) Typography: restrict to the defined type scale; flag font sizes or weights not in the style guide. (4) Contrast: text on background must meet WCAG AA (4.5:1 body, 3:1 large). (5) Touch targets: minimum 44px. Report findings as a short list with frame name and issue; do not modify the file unless the user asks.',
    status: 'public',
    created_at: new Date().toISOString()
  },
  {
    id: 'competitor-research',
    name: 'Competitor Research Expert',
    category: 'Research',
    description: 'Structure for competitor research workflows: positioning, features, pricing, and SWOT-style output.',
    full_description: 'Base knowledge for running competitor research with Vy: how to structure a competitive overview, compare features and pricing, and produce SWOT-style summaries. Use when preparing battle cards or strategy docs.',
    use_cases: ['Build a competitor overview table', 'Compare features and pricing', 'Draft SWOT-style summaries'],
    tags: ['research', 'competitors', 'strategy', 'positioning'],
    author: 'texflow',
    price: 0,
    paid: false,
    preamble: 'You are helping with competitor research. Output structure: (1) For each competitor: name, one-line positioning, target segment, key differentiators. (2) Feature matrix: rows = capabilities, columns = competitors; use Yes/No/Partial and note source. (3) Pricing: list public pricing tiers and note whether enterprise is custom. (4) SWOT: one paragraph per competitor with Strengths, Weaknesses, Opportunities, Threats. Always cite sources (URL or "user-provided"); do not invent pricing or features.',
    status: 'public',
    created_at: new Date().toISOString()
  },
  {
    id: 'morning-productivity-routine',
    name: 'Morning Productivity Routine Expert',
    category: 'Productivity',
    description: 'Morning routine and prioritization preamble: triage, top 3, and time-blocking rules for Vy.',
    full_description: 'Curated knowledge for a morning productivity workflow: triage inbox and tasks, pick a top 3 for the day, and apply simple time-blocking rules. Use with Vy to run a consistent start-of-day routine.',
    use_cases: ['Triage tasks and pick top 3', 'Time-block the day', 'Draft a short daily plan'],
    tags: ['productivity', 'morning', 'prioritization', 'time-blocking'],
    author: 'texflow',
    price: 0,
    paid: false,
    preamble: 'You are supporting a morning productivity routine. Steps: (1) Triage: list all open tasks; label each as Urgent/Important/Later. (2) Top 3: user picks exactly 3 tasks for today; you confirm and write them in one sentence each. (3) Time-block: suggest 1–2 hour blocks for deep work and place the top 3; leave buffer between blocks. (4) Output: one short paragraph summary of the day plan and one line per top-3 task. Do not add new tasks; only work from the list the user provides.',
    status: 'public',
    created_at: new Date().toISOString()
  }
];

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  let existing = [];
  try {
    const raw = await readFile(EXPERTS_PATH, 'utf8');
    existing = JSON.parse(raw);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (existing.length > 0) {
    console.log('data/experts.json already has entries; skipping seed.');
    process.exit(0);
    return;
  }
  await writeFile(EXPERTS_PATH, JSON.stringify(SEED_EXPERTS, null, 2), 'utf8');
  console.log('Seeded 5 experts to data/experts.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
