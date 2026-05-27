'use client';

import { useState, useMemo } from 'react';
import { Sparkles, Search, ExternalLink, Star, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Skill data
// ---------------------------------------------------------------------------

interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  logo: string;
  tags: string[];
  sourceRepo: string;
  sourcePath: string;
  author: string;
  featured?: boolean;
}

const SI = 'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons';

const SKILLS: Skill[] = [
  // AI & ML
  { id: 'claude-api', name: 'Claude API', description: 'Build, debug, and optimize Claude API / Anthropic SDK apps with prompt caching', category: 'ai-ml', logo: `${SI}/anthropic.svg`, tags: ['sdk', 'llm', 'caching'], sourceRepo: 'anthropics/skills', sourcePath: 'skills/claude-api', author: 'Anthropic', featured: true },
  { id: 'openai-sdk', name: 'OpenAI SDK', description: 'Integrate OpenAI APIs — GPT, embeddings, function calling, DALL-E, Whisper', category: 'ai-ml', logo: `${SI}/openai.svg`, tags: ['gpt', 'embeddings', 'vision'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/openai-sdk', author: 'Community' },
  { id: 'langchain', name: 'LangChain', description: 'Build LLM-powered apps — RAG pipelines, agents, chains, vector stores', category: 'ai-ml', logo: `${SI}/langchain.svg`, tags: ['rag', 'agents', 'chains'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/langchain', author: 'Community' },
  { id: 'mcp-builder', name: 'MCP Builder', description: 'Create MCP servers that enable LLMs to interact with external services', category: 'ai-ml', logo: `${SI}/anthropic.svg`, tags: ['mcp', 'tools', 'protocol'], sourceRepo: 'anthropics/skills', sourcePath: 'skills/mcp-builder', author: 'Anthropic', featured: true },
  { id: 'skill-creator', name: 'Skill Creator', description: 'Create, modify, and benchmark agent skills with eval-driven iteration', category: 'ai-ml', logo: `${SI}/anthropic.svg`, tags: ['meta', 'evals', 'authoring'], sourceRepo: 'anthropics/skills', sourcePath: 'skills/skill-creator', author: 'Anthropic' },
  { id: 'ai-sdk', name: 'Vercel AI SDK', description: 'Build AI-powered apps with the Vercel AI SDK — streaming, tool use, RAG', category: 'ai-ml', logo: `${SI}/vercel.svg`, tags: ['streaming', 'react', 'rag'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/ai-sdk', author: 'Community' },
  // Frontend
  { id: 'nextjs', name: 'Next.js', description: 'Production-grade React apps with App Router, Server Components, and Server Actions', category: 'frontend', logo: `${SI}/nextdotjs.svg`, tags: ['react', 'ssr', 'app-router'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/nextjs', author: 'Community', featured: true },
  { id: 'angular', name: 'Angular', description: 'TypeScript-based frontend framework — components, DI, RxJS, routing, forms', category: 'frontend', logo: `${SI}/angular.svg`, tags: ['typescript', 'spa', 'rxjs'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/angular', author: 'Community' },
  { id: 'vue', name: 'Vue.js', description: 'Progressive JavaScript framework — Composition API, reactive refs, SFCs', category: 'frontend', logo: `${SI}/vuedotjs.svg`, tags: ['composition-api', 'reactive', 'sfc'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/vue', author: 'Community' },
  { id: 'svelte', name: 'Svelte', description: 'Svelte 5 and SvelteKit 2 — runes, snippets, stores, compiled to vanilla JS', category: 'frontend', logo: `${SI}/svelte.svg`, tags: ['compiler', 'runes', 'sveltekit'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/svelte', author: 'Community' },
  { id: 'tailwindcss', name: 'Tailwind CSS', description: 'Utility-first CSS v4 — layout, spacing, typography, responsive design tokens', category: 'frontend', logo: `${SI}/tailwindcss.svg`, tags: ['css', 'utility', 'responsive'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/tailwindcss', author: 'Community' },
  { id: 'frontend-design', name: 'Frontend Design', description: 'Create distinctive, production-grade UIs that avoid generic AI aesthetics', category: 'frontend', logo: `${SI}/anthropic.svg`, tags: ['ui', 'design', 'creative'], sourceRepo: 'anthropics/skills', sourcePath: 'skills/frontend-design', author: 'Anthropic', featured: true },
  { id: 'accessibility-auditor', name: 'Accessibility Auditor', description: 'Audit web pages for WCAG 2.2 — contrast, keyboard nav, screen readers', category: 'frontend', logo: `${SI}/w3c.svg`, tags: ['wcag', 'a11y', 'audit'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/accessibility-auditor', author: 'Community' },
  // Backend
  { id: 'fastapi', name: 'FastAPI', description: 'Modern Python API framework — type hints, Pydantic, async, auto OpenAPI docs', category: 'backend', logo: `${SI}/fastapi.svg`, tags: ['python', 'async', 'pydantic'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/fastapi', author: 'Community' },
  { id: 'django', name: 'Django', description: 'Batteries-included Python web framework — ORM, admin, auth, templates', category: 'backend', logo: `${SI}/django.svg`, tags: ['python', 'orm', 'admin'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/django', author: 'Community' },
  { id: 'flask', name: 'Flask', description: 'Lightweight Python micro web framework — Jinja2, Werkzeug, extensions', category: 'backend', logo: `${SI}/flask.svg`, tags: ['python', 'micro', 'jinja'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/flask', author: 'Community' },
  { id: 'graphql', name: 'GraphQL', description: 'Build and consume GraphQL APIs — schemas, resolvers, subscriptions, federation', category: 'backend', logo: `${SI}/graphql.svg`, tags: ['api', 'schema', 'federation'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/graphql', author: 'Community' },
  { id: 'grpc', name: 'gRPC', description: 'High-performance RPC with Protocol Buffers — streaming, interceptors, health checks', category: 'backend', logo: `${SI}/google.svg`, tags: ['rpc', 'protobuf', 'streaming'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/grpc', author: 'Community' },
  { id: 'rest-api', name: 'REST API Design', description: 'Design RESTful APIs — resource modeling, status codes, pagination, OpenAPI docs', category: 'backend', logo: `${SI}/openapiinitiative.svg`, tags: ['rest', 'openapi', 'crud'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/rest-api', author: 'Community' },
  { id: 'celery', name: 'Celery', description: 'Background tasks in Python — async workers, periodic jobs, task queues', category: 'backend', logo: `${SI}/celery.svg`, tags: ['python', 'queue', 'workers'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/celery', author: 'Community' },
  { id: 'rabbitmq', name: 'RabbitMQ', description: 'Message broker — queues, exchanges, routing, dead-letter, RPC patterns', category: 'backend', logo: `${SI}/rabbitmq.svg`, tags: ['messaging', 'amqp', 'queue'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/rabbitmq', author: 'Community' },
  { id: 'kafka', name: 'Apache Kafka', description: 'Event-driven streaming — pub/sub, event sourcing, real-time data pipelines', category: 'backend', logo: `${SI}/apachekafka.svg`, tags: ['streaming', 'events', 'pubsub'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/kafka', author: 'Community' },
  { id: 'rate-limiter', name: 'Rate Limiter', description: 'API rate limiting — token bucket, sliding window, Redis-backed distributed counters', category: 'backend', logo: `${SI}/cloudflare.svg`, tags: ['security', 'throttle', 'redis'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/rate-limiter', author: 'Community' },
  // Database
  { id: 'postgresql', name: 'PostgreSQL', description: 'Schema design, queries, JSONB, full-text search, RLS, performance tuning', category: 'database', logo: `${SI}/postgresql.svg`, tags: ['sql', 'jsonb', 'rls'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/postgresql', author: 'Community', featured: true },
  { id: 'mongodb', name: 'MongoDB', description: 'Document schemas, aggregation pipelines, indexes, Atlas Search, vector search', category: 'database', logo: `${SI}/mongodb.svg`, tags: ['nosql', 'aggregation', 'vector'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/mongodb', author: 'Community' },
  { id: 'redis', name: 'Redis', description: 'In-memory data store — caching, pub/sub, streams, rate limiting, leaderboards', category: 'database', logo: `${SI}/redis.svg`, tags: ['cache', 'pubsub', 'streams'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/redis', author: 'Community' },
  { id: 'prisma', name: 'Prisma', description: 'TypeScript ORM — declarative schema, type-safe client, zero-downtime migrations', category: 'database', logo: `${SI}/prisma.svg`, tags: ['orm', 'typescript', 'migrations'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/prisma', author: 'Community' },
  { id: 'supabase', name: 'Supabase', description: 'Postgres backend — auth, real-time subscriptions, storage, edge functions, RLS', category: 'database', logo: `${SI}/supabase.svg`, tags: ['auth', 'realtime', 'storage'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/supabase', author: 'Community' },
  { id: 'firebase', name: 'Firebase', description: "Google's app platform — Firestore, auth, Cloud Functions, hosting, analytics", category: 'database', logo: `${SI}/firebase.svg`, tags: ['firestore', 'auth', 'functions'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/firebase', author: 'Community' },
  // DevOps
  { id: 'github-actions', name: 'GitHub Actions', description: 'CI/CD pipelines — workflows, matrix builds, caching, secrets, reusable workflows', category: 'devops', logo: `${SI}/githubactions.svg`, tags: ['ci-cd', 'automation', 'workflows'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/github-actions', author: 'Community', featured: true },
  { id: 'ansible', name: 'Ansible', description: 'Configuration management — playbooks, inventory, roles, Vault, multi-server deployments', category: 'devops', logo: `${SI}/ansible.svg`, tags: ['automation', 'playbooks', 'vault'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/ansible', author: 'Community' },
  { id: 'nginx', name: 'Nginx', description: 'Web server, reverse proxy, load balancer — TLS, caching, rate limiting, headers', category: 'devops', logo: `${SI}/nginx.svg`, tags: ['proxy', 'tls', 'load-balancer'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/nginx', author: 'Community' },
  { id: 'cloudflare', name: 'Cloudflare', description: 'CDN, DDoS protection, DNS, SSL, WAF, Workers — protect and accelerate sites', category: 'devops', logo: `${SI}/cloudflare.svg`, tags: ['cdn', 'dns', 'workers'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/cloudflare', author: 'Community' },
  { id: 'sentry', name: 'Sentry', description: 'Error monitoring, APM, session replay — track crashes and performance in production', category: 'devops', logo: `${SI}/sentry.svg`, tags: ['monitoring', 'errors', 'apm'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/sentry', author: 'Community' },
  { id: 'datadog', name: 'Datadog', description: 'Infrastructure monitoring, APM, log management, dashboards, alerting', category: 'devops', logo: `${SI}/datadog.svg`, tags: ['monitoring', 'metrics', 'logs'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/datadog', author: 'Community' },
  // Testing & Security
  { id: 'jest', name: 'Jest', description: 'JavaScript testing — unit, integration, snapshot, mocking, code coverage', category: 'testing', logo: `${SI}/jest.svg`, tags: ['unit-test', 'mocking', 'coverage'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/jest', author: 'Community' },
  { id: 'pytest', name: 'pytest', description: 'Python testing — fixtures, mocking, async tests, coverage, TDD', category: 'testing', logo: `${SI}/pytest.svg`, tags: ['python', 'fixtures', 'tdd'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/pytest', author: 'Community' },
  { id: 'cypress', name: 'Cypress', description: 'End-to-end web testing — component tests, CI parallelization, custom commands', category: 'testing', logo: `${SI}/cypress.svg`, tags: ['e2e', 'browser', 'ci'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/cypress', author: 'Community' },
  { id: 'webapp-testing', name: 'Webapp Testing', description: 'Test local web apps with Playwright — screenshots, browser logs, UI verification', category: 'testing', logo: `${SI}/playwright.svg`, tags: ['playwright', 'screenshots', 'verification'], sourceRepo: 'anthropics/skills', sourcePath: 'skills/webapp-testing', author: 'Anthropic' },
  { id: 'ab-test-setup', name: 'A/B Testing', description: 'Plan, design, and implement A/B tests — hypotheses, variants, measurement', category: 'testing', logo: `${SI}/googleoptimize.svg`, tags: ['experiment', 'hypothesis', 'variants'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/ab-test-setup', author: 'Community' },
  { id: 'security-audit', name: 'Security Audit', description: 'Scan for vulnerabilities — OWASP Top 10, secrets, CVEs, SQL injection, XSS', category: 'security', logo: `${SI}/owasp.svg`, tags: ['owasp', 'vulnerabilities', 'cve'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/security-audit', author: 'Community' },
  // Integrations
  { id: 'airtable', name: 'Airtable', description: 'Airtable API — bases, tables, records, fields, views, webhooks, OAuth', category: 'integrations', logo: `${SI}/airtable.svg`, tags: ['api', 'database', 'webhooks'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/airtable', author: 'Community' },
  { id: 'notion', name: 'Notion', description: 'Notion API — databases, pages, blocks, comments, search, OAuth', category: 'integrations', logo: `${SI}/notion.svg`, tags: ['api', 'workspace', 'pages'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/notion', author: 'Community' },
  { id: 'jira', name: 'Jira', description: 'Project management — issues, workflows, boards, sprints, JQL, automation', category: 'integrations', logo: `${SI}/jira.svg`, tags: ['issues', 'sprints', 'agile'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/jira', author: 'Community' },
  { id: 'linear', name: 'Linear', description: 'Issue tracking — projects, cycles, triage, GraphQL API, GitHub sync', category: 'integrations', logo: `${SI}/linear.svg`, tags: ['issues', 'cycles', 'graphql'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/linear', author: 'Community' },
  { id: 'stripe', name: 'Stripe Payments', description: 'Complete payment flow — checkout, subscriptions, invoices, webhooks', category: 'integrations', logo: `${SI}/stripe.svg`, tags: ['payments', 'subscriptions', 'webhooks'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/stripe', author: 'Community' },
  { id: 'twilio', name: 'Twilio', description: 'SMS, voice calls, WhatsApp messaging, 2FA verification, IVR systems', category: 'integrations', logo: `${SI}/twilio.svg`, tags: ['sms', 'voice', '2fa'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/twilio', author: 'Community' },
  { id: 'sendgrid', name: 'SendGrid', description: 'Transactional and marketing email — templates, tracking, deliverability', category: 'integrations', logo: `${SI}/sendgrid.svg`, tags: ['email', 'templates', 'deliverability'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/sendgrid', author: 'Community' },
  { id: 'shopify', name: 'Shopify', description: 'E-commerce — Liquid themes, Storefront API, custom apps, Hydrogen headless', category: 'integrations', logo: `${SI}/shopify.svg`, tags: ['ecommerce', 'liquid', 'headless'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/shopify', author: 'Community' },
  { id: 'wordpress', name: 'WordPress', description: 'CMS powering 43% of the web — Gutenberg, themes, plugins, REST API, WP-CLI', category: 'integrations', logo: `${SI}/wordpress.svg`, tags: ['cms', 'gutenberg', 'plugins'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/wordpress', author: 'Community' },
  { id: 'woocommerce', name: 'WooCommerce', description: 'WordPress e-commerce — products, orders, checkout, payment gateways', category: 'integrations', logo: `${SI}/woocommerce.svg`, tags: ['ecommerce', 'wordpress', 'payments'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/woocommerce', author: 'Community' },
  { id: 'contentful', name: 'Contentful', description: 'API-first CMS — content models, delivery API, localization, rich text, webhooks', category: 'integrations', logo: `${SI}/contentful.svg`, tags: ['cms', 'headless', 'i18n'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/contentful', author: 'Community' },
  { id: 'sanity', name: 'Sanity', description: 'Structured content platform — GROQ queries, Studio, Portable Text, Next.js', category: 'integrations', logo: `${SI}/sanity.svg`, tags: ['cms', 'groq', 'structured'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/sanity', author: 'Community' },
  { id: 'zapier', name: 'Zapier', description: 'No-code automation — connect apps, sync data, automate workflows between SaaS', category: 'integrations', logo: `${SI}/zapier.svg`, tags: ['automation', 'nocode', 'integrations'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/zapier', author: 'Community' },
  { id: 'analytics-tracking', name: 'Analytics Tracking', description: 'Set up GA4, conversion tracking, event tracking, UTM parameters, GTM', category: 'integrations', logo: `${SI}/googleanalytics.svg`, tags: ['ga4', 'tracking', 'gtm'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/analytics-tracking', author: 'Community' },
  // Documents
  { id: 'docx', name: 'Word Documents', description: 'Create, read, edit .docx files — TOC, headers, page numbers, letterheads', category: 'documents', logo: `${SI}/microsoftword.svg`, tags: ['word', 'docx', 'formatting'], sourceRepo: 'anthropics/skills', sourcePath: 'skills/docx', author: 'Anthropic' },
  { id: 'xlsx', name: 'Spreadsheets', description: 'Read, write, format .xlsx files — formulas, charts, data cleaning, pivot tables', category: 'documents', logo: `${SI}/microsoftexcel.svg`, tags: ['excel', 'formulas', 'charts'], sourceRepo: 'anthropics/skills', sourcePath: 'skills/xlsx', author: 'Anthropic' },
  { id: 'pptx', name: 'Presentations', description: 'Create and edit .pptx slide decks — layouts, speaker notes, templates', category: 'documents', logo: `${SI}/microsoftpowerpoint.svg`, tags: ['slides', 'presentations', 'templates'], sourceRepo: 'anthropics/skills', sourcePath: 'skills/pptx', author: 'Anthropic' },
  { id: 'pdf', name: 'PDF Processing', description: 'Read, merge, split, watermark, OCR, encrypt PDFs — forms and image extraction', category: 'documents', logo: `${SI}/adobeacrobatreader.svg`, tags: ['pdf', 'ocr', 'merge'], sourceRepo: 'anthropics/skills', sourcePath: 'skills/pdf', author: 'Anthropic' },
  { id: 'doc-coauthoring', name: 'Doc Co-Authoring', description: 'Structured workflow for co-authoring docs, specs, proposals, and decision docs', category: 'documents', logo: `${SI}/anthropic.svg`, tags: ['writing', 'specs', 'collaboration'], sourceRepo: 'anthropics/skills', sourcePath: 'skills/doc-coauthoring', author: 'Anthropic' },
];

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const CATEGORIES = [
  { id: 'all', label: 'All', icon: '🔥' },
  { id: 'ai-ml', label: 'AI & ML', icon: '🧠' },
  { id: 'frontend', label: 'Frontend', icon: '🎨' },
  { id: 'backend', label: 'Backend', icon: '⚙️' },
  { id: 'database', label: 'Database', icon: '🗄️' },
  { id: 'devops', label: 'DevOps', icon: '🚀' },
  { id: 'testing', label: 'Testing', icon: '🧪' },
  { id: 'security', label: 'Security', icon: '🔒' },
  { id: 'integrations', label: 'Integrations', icon: '🔗' },
  { id: 'documents', label: 'Documents', icon: '📄' },
];

// ---------------------------------------------------------------------------
// Skill Card
// ---------------------------------------------------------------------------

function SkillCard({ skill, onSelect }: { skill: Skill; onSelect: (s: Skill) => void }) {
  return (
    <button
      className="text-left rounded-xl border border-border bg-card p-4 transition-all duration-150 hover:shadow-lg hover:border-primary/30 hover:-translate-y-0.5 group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      onClick={() => onSelect(skill)}
    >
      <div className="flex items-start gap-3">
        {/* Logo */}
        <div className="size-10 rounded-lg bg-muted/60 flex items-center justify-center shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={skill.logo} alt="" className="h-5 w-5 object-contain dark:invert" />
        </div>

        <div className="flex-1 min-w-0">
          {/* Name + badge */}
          <div className="flex items-center gap-1.5">
            <h3 className="text-[13px] font-semibold leading-tight truncate">{skill.name}</h3>
            {skill.author === 'Anthropic' && (
              <span className="shrink-0 text-[8px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold uppercase">
                Official
              </span>
            )}
          </div>
          {/* Description */}
          <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2 mt-0.5">
            {skill.description}
          </p>
        </div>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-1 mt-2.5 ml-[52px]">
        {skill.tags.map(tag => (
          <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
            {tag}
          </span>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-2.5 ml-[52px]">
        <span className="text-[9px] text-muted-foreground">{skill.sourceRepo.split('/')[0]}</span>
        <span className="text-[10px] text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
          View <ArrowRight className="size-2.5" />
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Skill Detail
// ---------------------------------------------------------------------------

function SkillDetail({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const ghUrl = `https://github.com/${skill.sourceRepo}/tree/main/${skill.sourcePath}`;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div className="fixed inset-x-4 top-[10%] bottom-[10%] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[480px] bg-background rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden border border-border">
        <div className="px-5 pt-5 pb-3 border-b border-border">
          <div className="flex items-start gap-3">
            <div className="size-12 rounded-xl bg-muted/60 flex items-center justify-center shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={skill.logo} alt="" className="h-7 w-7 object-contain dark:invert" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold">{skill.name}</h2>
                {skill.author === 'Anthropic' && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold uppercase">Official</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{skill.description}</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {skill.tags.map(tag => (
                  <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">{tag}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border p-2.5">
              <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">Category</div>
              <div className="text-xs font-medium">{CATEGORIES.find(c => c.id === skill.category)?.label}</div>
            </div>
            <div className="rounded-lg border border-border p-2.5">
              <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">Author</div>
              <div className="text-xs font-medium">{skill.author}</div>
            </div>
          </div>

          <div className="rounded-lg border border-border p-2.5">
            <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">Source</div>
            <a href={ghUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
              {skill.sourceRepo}/{skill.sourcePath} <ExternalLink className="size-2.5" />
            </a>
          </div>

          <div className="rounded-lg border border-border p-3 bg-muted/30">
            <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Install</div>
            <code className="text-[11px] font-mono block bg-background rounded-md p-2.5 border border-border select-all break-all">
              npx @anthropic-ai/skills install {skill.sourceRepo}/{skill.sourcePath}
            </code>
          </div>

          <div className="rounded-lg border border-border p-2.5">
            <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Compatible With</div>
            <div className="flex flex-wrap gap-1.5">
              {['Claude Code', 'Codex', 'Cursor', 'Gemini CLI', 'OpenCode', 'VS Code', 'Roo Code'].map(a => (
                <span key={a} className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">{a}</span>
              ))}
              <span className="text-[10px] text-muted-foreground">+10 more</span>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between">
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
          <a href={ghUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90">
            View on GitHub <ExternalLink className="size-3" />
          </a>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function SkillsView() {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);

  const filtered = useMemo(() => {
    let result = SKILLS;
    if (activeCategory !== 'all') result = result.filter(s => s.category === activeCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(s =>
        s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) || s.tags.some(t => t.includes(q))
      );
    }
    return result;
  }, [search, activeCategory]);

  const featured = useMemo(() => SKILLS.filter(s => s.featured), []);

  const categoryCounts = useMemo(() => {
    const c: Record<string, number> = { all: SKILLS.length };
    for (const s of SKILLS) c[s.category] = (c[s.category] || 0) + 1;
    return c;
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-5 pt-4 pb-3 border-b border-border space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-amber-500" />
          <h2 className="text-sm font-semibold">Skill Hub</h2>
          <span className="text-xs text-muted-foreground">{SKILLS.length} skills</span>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search skills..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-muted/50 border border-input placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Category grid */}
        <div className="grid grid-cols-5 gap-1.5">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={cn(
                'flex flex-col items-center gap-0.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors',
                activeCategory === cat.id
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="text-sm">{cat.icon}</span>
              <span className="truncate max-w-full px-0.5">{cat.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <Search className="size-8 opacity-30" />
            <p className="text-sm">No skills match your search</p>
            <button onClick={() => { setSearch(''); setActiveCategory('all'); }} className="text-xs text-primary hover:underline">Clear filters</button>
          </div>
        ) : (
          <div className="p-4 space-y-5">
            {/* Featured — only when showing all */}
            {activeCategory === 'all' && !search && (
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <Star className="size-3.5 text-amber-500 fill-amber-500" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Featured</h3>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
                  {featured.map(skill => (
                    <SkillCard key={skill.id} skill={skill} onSelect={setSelectedSkill} />
                  ))}
                </div>
              </div>
            )}

            {/* All skills */}
            <div>
              {activeCategory === 'all' && !search && (
                <div className="flex items-center gap-2 mb-2.5">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">All Skills</h3>
                  <span className="text-[10px] text-muted-foreground">({categoryCounts.all})</span>
                </div>
              )}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
                {filtered.map(skill => (
                  <SkillCard key={skill.id} skill={skill} onSelect={setSelectedSkill} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {selectedSkill && <SkillDetail skill={selectedSkill} onClose={() => setSelectedSkill(null)} />}
    </div>
  );
}
