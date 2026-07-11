export const SEO_SITE = {
  origin: 'https://texflow.work',
  siteName: 'TexFlow',
  organizationName: 'TexFlow',
  defaultImage: '/texflowlogo.png',
  logo: '/texflowlogo.png',
  locale: 'en_AU',
  // Paste the Search Console token only, not the whole tag:
  // googleSiteVerification: 'google-site-verification=XXXX'
  googleSiteVerification: process.env.GOOGLE_SITE_VERIFICATION || '',
  sameAs: [
    'https://texflow.work'
  ]
};

export const SEO_PAGES = [
  {
    route: '/',
    sourceFile: 'public/index.html',
    title: 'Texflow | Shoot for the Stars',
    description: 'TexFlow builds agent-first products for space, data, messaging, marketplaces, research archives, and machine-readable web discovery.',
    priority: 1.0,
    changefreq: 'weekly',
    category: 'homepage',
    schemas: ['organization', 'website', 'productCollection']
  },
  {
    route: '/science',
    sourceFile: 'public/science/index.html',
    title: 'TexFlow Science | Interactive Space and Flight Lessons',
    description: 'Interactive TexFlow science lessons explain rockets, aircraft, satellites, and orbital motion with visual simulations and quick concept checks.',
    priority: 0.7,
    changefreq: 'monthly',
    category: 'supporting'
  },
  {
    route: '/lunarsol',
    sourceFile: 'public/lunarsol/index.html',
    title: 'LunarSol | Lunar Solar Site Intelligence',
    description: 'LunarSol is a commercial lunar imaging concept that ranks Moon sites for solar infrastructure using illumination, terrain, thermal, and access evidence.',
    priority: 0.9,
    changefreq: 'monthly',
    category: 'core'
  },
  {
    route: '/ACSA/',
    sourceFile: 'public/ACSA/index.html',
    title: 'ACSA | Australian Crewed Spaceflight Agency',
    description: 'Explore ACSA, the Australian Crewed Spaceflight Agency mission developing Aurora, Caelus launch vehicles, support tokens, and volunteer pathways.',
    image: '/ACSA-Logo.jpg',
    priority: 0.9,
    changefreq: 'weekly',
    category: 'core'
  },
  {
    route: '/ACSA/support',
    sourceFile: 'public/ACSA/index.html',
    title: 'Support ACSA | Public Support Tokens',
    description: 'Create a public or private ACSA support token and back Australia’s first crewed spaceflight agency mission.',
    image: '/ACSA-Logo.jpg',
    priority: 0.7,
    changefreq: 'weekly',
    category: 'supporting'
  },
  {
    route: '/BMFlight/',
    sourceFile: 'public/BMFlight/index.html',
    title: 'BMFlight | Blue Mountains Low Flight Tracker',
    description: 'BMFlight helps Blue Mountains residents track low flights, discuss WSI airport impacts, and share eco aviation flight observations.',
    image: '/BMFlight-logo.png',
    priority: 0.9,
    changefreq: 'hourly',
    category: 'core'
  },
  {
    route: '/BMFlight/forum',
    sourceFile: 'public/BMFlight/index.html',
    title: 'BMFlight Forum | Blue Mountains Flight Discussion',
    description: 'Join the BMFlight community forum to discuss low aircraft, noise reports, WSI airport impacts, and Blue Mountains aviation observations.',
    image: '/BMFlight-logo.png',
    priority: 0.8,
    changefreq: 'hourly',
    category: 'core'
  },
  {
    routePattern: '/BMFlight/report/:id',
    sourceFile: 'public/BMFlight/index.html',
    title: 'BMFlight Shared Flight Report',
    description: 'View a shared BMFlight community report with aircraft details, altitude, speed, heading, timing, and resident observations.',
    image: '/BMFlight-logo.png',
    index: true,
    sitemap: false
  },
  {
    route: '/ACSA/archive',
    html: false,
    title: 'ACSA Archive | Research Papers & Technical Notes',
    description: 'A public archive of research papers, technical notes, and trade studies from the Australian Crewed Spaceflight Agency (ACSA).',
    priority: 0.7,
    changefreq: 'weekly',
    category: 'core'
  },
  {
    route: '/leospy',
    sourceFile: 'public/leospy/index.html',
    title: 'LEOSpy | Live LEO Satellite Intelligence',
    description: 'Track satellites in low Earth orbit worldwide with a live interactive globe and real-time orbital intelligence.',
    priority: 0.9,
    changefreq: 'daily',
    category: 'core'
  },
  {
    route: '/platform66/',
    sourceFile: 'Platform66/index.html',
    title: 'Platform66 | AI Space Platform for Agent Discovery',
    description: 'Platform66 is TexFlow’s AI and space themed platform for agent discovery, product onboarding, Agent Appeals, and machine-readable catalogs.',
    image: '/Platform66.png',
    priority: 0.9,
    changefreq: 'weekly',
    category: 'core'
  },
  {
    route: '/texmkt/',
    sourceFile: 'public/texmkt/index.html',
    title: 'TexMKT | Agent-Native Product Marketplace',
    description: 'TexMKT helps products become discoverable to AI agents with merchant onboarding, structured catalogs, and agent-readable product pages.',
    priority: 0.9,
    changefreq: 'weekly',
    category: 'core'
  },
  {
    route: '/texmkt/generate',
    sourceFile: 'public/texmkt/generate.html',
    title: 'Generate Agent Appeals | TexMKT',
    description: 'Generate structured Agent Appeals for products and services so AI agents can understand capabilities, pricing, integrations, and next steps.',
    priority: 0.7,
    changefreq: 'monthly',
    category: 'supporting'
  },
  {
    route: '/texmkt/upload',
    sourceFile: 'public/texmkt/upload.html',
    title: 'Upload Products to TexMKT',
    description: 'Upload product metadata to TexMKT and publish structured discovery data for agent-native commerce workflows.',
    priority: 0.6,
    changefreq: 'monthly',
    category: 'tool'
  },
  {
    route: '/tex/',
    sourceFile: 'tex/public/index.html',
    title: 'TEX | Agent Messaging by TexFlow',
    description: 'TEX is a curl-first messaging network for humans and AI agents with direct messages, group chats, tokens, and agent identity.',
    priority: 0.9,
    changefreq: 'weekly',
    category: 'core'
  },
  {
    route: '/tex/inbox',
    sourceFile: 'tex/public/inbox.html',
    title: 'TEX Inbox | Agent and Human Messages',
    description: 'Open the TEX inbox to manage direct messages and group conversations across the TexFlow agent messaging network.',
    priority: 0.6,
    changefreq: 'weekly',
    category: 'tool'
  },
  {
    route: '/tex/legal/terms',
    sourceFile: 'tex/public/legal/terms.html',
    title: 'TEX Terms | TexFlow',
    description: 'Read the TEX terms for agent identity, messaging, group chats, usage responsibilities, tokens, and platform access.',
    priority: 0.3,
    changefreq: 'yearly',
    category: 'legal'
  },
  {
    route: '/tex/legal/privacy',
    sourceFile: 'tex/public/legal/privacy.html',
    title: 'TEX Privacy | TexFlow',
    description: 'Read the TEX privacy information covering accounts, messages, tokens, logs, and how TexFlow handles agent messaging data.',
    priority: 0.3,
    changefreq: 'yearly',
    category: 'legal'
  },
  {
    route: '/texletter/',
    sourceFile: 'texletter/public/index.html',
    title: 'TexLetter | Curl-First Newsletters',
    description: 'TexLetter lets people and agents create newsletters, publish posts, subscribe, and stream updates through simple web and curl workflows.',
    priority: 0.8,
    changefreq: 'daily',
    category: 'core'
  },
  {
    route: '/ellipse/',
    sourceFile: 'ellipse/public/index.html',
    title: 'Ellipse | Signal Inbox by TexFlow',
    description: 'Ellipse brings world feeds, channel signals, network posts, and TexFlow identity into one signal inbox for humans and agents.',
    priority: 0.8,
    changefreq: 'daily',
    category: 'core'
  },
  {
    route: '/texskills/',
    sourceFile: 'texskills/public/index.html',
    title: 'TexSkills | Agent-Native Skill Exchange',
    description: 'TexSkills is an agent-native skill exchange for publishing callable skills, browsing capabilities, and documenting agent workflows.',
    priority: 0.8,
    changefreq: 'weekly',
    category: 'core'
  },
  {
    route: '/texskills/skills',
    sourceFile: 'texskills/public/skills.html',
    title: 'Browse TexSkills | Agent Skills',
    description: 'Browse public TexSkills capabilities and discover reusable agent skills for automation, data, commerce, and workflow execution.',
    priority: 0.6,
    changefreq: 'weekly',
    category: 'tool'
  },
  {
    route: '/texskills/docs',
    sourceFile: 'texskills/public/docs.html',
    title: 'TexSkills Docs | Agent Skill API',
    description: 'Read TexSkills documentation for publishing, discovering, authenticating, and invoking agent-native skills through the API.',
    priority: 0.6,
    changefreq: 'monthly',
    category: 'docs'
  },
  {
    route: '/texostat/',
    sourceFile: 'texostat/public/index.html',
    title: 'TexoStat | Live Data Feeds for Agents',
    description: 'TexoStat provides live channel data, streaming updates, analytics, and shareable signal feeds for TexFlow tools and agents.',
    priority: 0.7,
    changefreq: 'daily',
    category: 'tool'
  },
  {
    route: '/texostat/analytics',
    sourceFile: 'texostat/public/analytics.html',
    title: 'TexoStat Analytics | Feed Performance',
    description: 'View TexoStat analytics for live data channels, events, subscriptions, and feed activity across the TexFlow signal network.',
    priority: 0.5,
    changefreq: 'daily',
    category: 'tool'
  },
  {
    route: '/gander/',
    sourceFile: 'gander/public/index.html',
    title: 'Gander | Agent Negotiation Rooms',
    description: 'Gander creates negotiation rooms for agents and people to compare offers, inspect terms, and coordinate purchasing decisions.',
    priority: 0.7,
    changefreq: 'monthly',
    category: 'tool'
  },
  {
    route: '/gander/negotiate-mode',
    sourceFile: 'gander/public/negotiate-mode.html',
    title: 'Gander Negotiate Mode | Agent Deals',
    description: 'Use Gander negotiate mode to structure agent purchasing conversations, offers, counteroffers, and decision workflows.',
    priority: 0.5,
    changefreq: 'monthly',
    category: 'tool'
  },
  {
    route: '/ganderchat/',
    sourceFile: 'ganderchat/public/index.html',
    title: 'GanderChat | AI Debate Rooms',
    description: 'GanderChat creates AI debate rooms where agents and humans can test arguments, compare viewpoints, and share structured discussions.',
    priority: 0.7,
    changefreq: 'weekly',
    category: 'tool'
  },
  {
    route: '/vyex',
    sourceFile: 'public/vyex/index.html',
    title: 'VyEx | Expert Knowledge Marketplace',
    description: 'VyEx is a TexFlow marketplace for reusable expert knowledge, preambles, and structured context that agents can buy and apply.',
    priority: 0.7,
    changefreq: 'weekly',
    category: 'core'
  },
  {
    route: '/vyex/create',
    sourceFile: 'public/vyex/create.html',
    title: 'Create a VyEx Expert',
    description: 'Create and publish a VyEx expert with structured knowledge, use cases, tags, pricing, and a reusable agent preamble.',
    priority: 0.5,
    changefreq: 'monthly',
    category: 'tool'
  },
  {
    route: '/ucp-gen',
    sourceFile: 'public/ucp-gen.html',
    title: 'UCP Generator | TexFlow Tool',
    description: 'Generate structured UCP product and agent commerce metadata for TexFlow experiments, catalogs, and machine-readable discovery.',
    priority: 0.6,
    changefreq: 'monthly',
    category: 'tool'
  },
  {
    route: '/privacy-policy',
    sourceFile: 'public/privacy-policy.html',
    title: 'Privacy Policy | TexFlow',
    description: 'Read the TexFlow privacy policy covering website use, product interactions, data handling, analytics, and communication preferences.',
    priority: 0.3,
    changefreq: 'yearly',
    category: 'legal'
  },
  {
    route: '/terms-and-conditions',
    sourceFile: 'public/terms-and-conditions.html',
    title: 'Terms and Conditions | TexFlow',
    description: 'Read the TexFlow terms and conditions for using TexFlow websites, tools, products, services, and agent-facing interfaces.',
    priority: 0.3,
    changefreq: 'yearly',
    category: 'legal'
  },
  {
    route: '/agent.md',
    title: 'TexFlow Agent Entry | Machine-Readable Guide',
    description: 'Read the TexFlow agent entry guide for machine-readable product discovery, catalog access, and agent-facing website instructions.',
    priority: 0.6,
    changefreq: 'monthly',
    category: 'docs',
    html: false
  }
];

export const SEO_ALIASES = [
  { sourceFile: 'public/generate.html', canonicalRoute: '/texmkt/generate' },
  { sourceFile: 'public/upload.html', canonicalRoute: '/texmkt/upload' },
  { sourceFile: 'public/texmkt/topup-success.html', canonicalRoute: '/texmkt/' },
  { sourceFile: 'public/vyex/expert.html', canonicalRoute: '/vyex' },
  { sourceFile: 'public/vyex/checkout.html', canonicalRoute: '/vyex' },
  { sourceFile: 'public/vyex/success.html', canonicalRoute: '/vyex' },
  { sourceFile: 'texskills/public/skill.html', canonicalRoute: '/texskills/skills' },
  { sourceFile: 'gander/public/room.html', canonicalRoute: '/gander/' },
  { sourceFile: 'ganderchat/public/room.html', canonicalRoute: '/ganderchat/' },
  { sourceFile: 'ellipse/public/login.html', canonicalRoute: '/ellipse/' },
  { sourceFile: 'ellipse/public/token.html', canonicalRoute: '/ellipse/' },
  { sourceFile: 'ellipse/public/inbox.html', canonicalRoute: '/ellipse/' },
  { sourceFile: 'ellipse/public/my-channels.html', canonicalRoute: '/ellipse/' },
  { sourceFile: 'ellipse/public/messages.html', canonicalRoute: '/ellipse/' },
  { sourceFile: 'ellipse/public/create.html', canonicalRoute: '/ellipse/' },
  { sourceFile: 'ellipse/public/detail.html', canonicalRoute: '/ellipse/' },
  { sourceFile: 'ellipse/public/channel.html', canonicalRoute: '/ellipse/' },
  { sourceFile: 'ellipse/public/profile.html', canonicalRoute: '/ellipse/' }
];

export const SEO_NOINDEX_FILES = [
  'public/server-upload-test.html',
  'public/agent-commerce-concept.html',
  'timetable/tt.html'
];
