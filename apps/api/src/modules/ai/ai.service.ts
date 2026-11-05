import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { ERROR_CODES } from '@ce/shared';
import { AppException } from '../../common/errors/app-exception.js';
import { richTextToPlain, validateRichText } from '../../common/richtext/richtext.js';
import { isValidTimeZone } from '../../common/time/timezone.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../core/redis/redis.constants.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { CoursesService } from '../courses/courses.service.js';
import { LearningService } from '../learning/learning.service.js';
import { EntitlementsService } from '../subscriptions/entitlements.service.js';
import { AiClient, type AiCall, type AiResult } from './ai.client.js';
import { creditsFor, monthStart, reserveFor } from './credits.js';

type Feature = 'LANDING_PAGE' | 'COURSE_OUTLINE' | 'LESSON_DRAFT' | 'QUIZ_QUESTIONS' | 'TUTOR';
const PENDING_WINDOW_MS = 5 * 60_000;
const TUTOR_KEY = 'ai.tutor';
const DEFAULT_TUTOR = { enabled: false, dailyLimit: 20 };

// ── output schemas (structured outputs) ─────────────────────
const OutlineSchema = z.object({
  sections: z.array(z.object({ title: z.string(), lessons: z.array(z.object({ title: z.string(), summary: z.string() })) })),
});
const DraftSchema = z.object({
  blocks: z.array(z.object({ kind: z.enum(['heading', 'paragraph', 'bullets', 'numbered']), text: z.string(), items: z.array(z.string()) })),
});
const QuizSchema = z.object({
  questions: z.array(z.object({ prompt: z.string(), options: z.array(z.string()), correctIndex: z.number().int(), explanation: z.string() })),
});

const LandingSchema = z.object({
  seoTitle: z.string(),
  seoDescription: z.string(),
  hero: z.object({ heading: z.string(), subheading: z.string(), ctaLabel: z.string() }),
  features: z.object({ heading: z.string(), items: z.array(z.object({ title: z.string(), text: z.string() })) }),
  courses: z.object({ heading: z.string(), featuredCourseIds: z.array(z.string()) }),
  about: z.object({ heading: z.string(), paragraphs: z.array(z.string()) }),
  faq: z.object({ heading: z.string(), items: z.array(z.object({ q: z.string(), a: z.string() })) }),
  cta: z.object({ heading: z.string(), text: z.string(), buttonLabel: z.string() }),
});
const LANGUAGES: Record<string, string> = { en: 'English', hi: 'Hindi (Devanagari script)', gu: 'Gujarati (Gujarati script)' };

export interface LandingInput { industry: string; audience?: string; tone?: 'friendly' | 'professional' | 'energetic' | 'premium'; language?: 'en' | 'hi' | 'gu'; highlights?: string }

export type OutlineDraft = z.infer<typeof OutlineSchema>;
const clip = (s: string, n: number) => s.trim().slice(0, n);

/** Converts the model's simple block list into allow-listed TipTap JSON. */
export function blocksToDoc(blocks: z.infer<typeof DraftSchema>['blocks']) {
  const text = (t: string) => (t.trim() ? [{ type: 'text', text: t.trim() }] : undefined);
  const list = (items: string[]) => items.filter((i) => i.trim()).map((i) => ({ type: 'listItem', content: [{ type: 'paragraph', content: text(i) }] }));
  const content = blocks.flatMap((b) => {
    if (b.kind === 'heading') return b.text.trim() ? [{ type: 'heading', attrs: { level: 2 }, content: text(b.text) }] : [];
    if (b.kind === 'bullets' || b.kind === 'numbered') {
      const items = list(b.items);
      const intro = b.text.trim() ? [{ type: 'paragraph', content: text(b.text) }] : [];
      return items.length ? [...intro, { type: b.kind === 'bullets' ? 'bulletList' : 'orderedList', content: items }] : intro;
    }
    return b.text.trim() ? [{ type: 'paragraph', content: text(b.text) }] : [];
  });
  const doc = { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
  validateRichText(doc);
  return doc;
}

/**
 * AI features (Claude) metered in monthly credits from the academy's plan (`ai.credits`).
 * Credits are reserved before each call under a per-academy lock (so parallel requests cannot
 * overspend) and settled to the real token usage afterwards — failed calls cost nothing.
 */
@Injectable()
export class AiService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly entitlements: EntitlementsService,
    private readonly ai: AiClient,
    private readonly courses: CoursesService,
    private readonly learning: LearningService,
  ) {}

  // ── credits ───────────────────────────────────────────────
  private async period() {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: this.ctx.requireTenantId() }, select: { timezone: true } });
    return monthStart(new Date(), isValidTimeZone(t.timezone) ? t.timezone : 'Asia/Kolkata');
  }

  private async balance() {
    const tenantId = this.ctx.requireTenantId();
    const ent = await this.entitlements.get(tenantId);
    const f = ent.features['ai.credits'];
    const { start, next } = await this.period();
    const [settled, pending] = await Promise.all([
      this.db.aiRequest.aggregate({ where: { createdAt: { gte: start }, status: { not: 'PENDING' } }, _sum: { creditsCharged: true } }),
      this.db.aiRequest.aggregate({ where: { createdAt: { gte: new Date(Math.max(start.getTime(), Date.now() - PENDING_WINDOW_MS)) }, status: 'PENDING' }, _sum: { reservedCredits: true } }),
    ]);
    const used = (settled._sum.creditsCharged ?? 0) + (pending._sum.reservedCredits ?? 0);
    const included = ent.active && f?.enabled === true;
    const limit = !included ? 0 : f.limit; // null = unlimited
    return { active: ent.active, included, limit, used, remaining: limit === null ? null : Math.max(0, limit - used), periodStart: start, periodEnd: next };
  }

  async usage() {
    const b = await this.balance();
    const [byFeature, recent] = await Promise.all([
      this.db.aiRequest.groupBy({ by: ['feature'], where: { createdAt: { gte: b.periodStart }, status: { not: 'PENDING' } }, _sum: { creditsCharged: true }, _count: { _all: true } }),
      this.db.aiRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(recent.map((r) => r.userId))] } }, select: { id: true, fullName: true } });
    return {
      configured: this.ai.configured,
      ...b,
      byFeature: byFeature.map((x) => ({ feature: x.feature, requests: x._count._all, credits: x._sum.creditsCharged ?? 0 })),
      recent: recent.map((r) => ({ id: r.id, feature: r.feature, status: r.status, credits: r.creditsCharged, user: users.find((u) => u.id === r.userId)?.fullName ?? null, createdAt: r.createdAt })),
    };
  }

  private async lock<T>(fn: () => Promise<T>): Promise<T> {
    const key = `lock:ai:${this.ctx.requireTenantId()}`;
    for (let i = 0; i < 50; i++) {
      if (await this.redis.set(key, '1', 'PX', 5000, 'NX')) {
        try {
          return await fn();
        } finally {
          await this.redis.del(key);
        }
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new AppException(ERROR_CODES.RATE_LIMITED, 'Too many AI requests at once. Please try again.', HttpStatus.TOO_MANY_REQUESTS);
  }

  /** Reserve → call Claude → settle. */
  private async run<S extends z.ZodType | undefined>(feature: Feature, userId: string, courseId: string | null, call: AiCall<S>) {
    if (!this.ai.configured) throw new AppException(ERROR_CODES.INTEGRATION_NOT_CONFIGURED, 'AI features are not set up on this platform yet.', HttpStatus.SERVICE_UNAVAILABLE);
    const promptChars = call.system.length + (call.context?.length ?? 0) + JSON.stringify(call.messages).length;
    const need = reserveFor(promptChars, call.maxTokens);
    const req = await this.lock(async () => {
      const b = await this.balance();
      if (!b.active) throw new AppException(ERROR_CODES.NO_ACTIVE_PLAN, 'Your academy has no active plan. Choose a plan in Billing.', HttpStatus.PAYMENT_REQUIRED);
      if (!b.included) throw new AppException(ERROR_CODES.FEATURE_NOT_IN_PLAN, 'AI features are not included in your current plan. Upgrade in Billing.', HttpStatus.FORBIDDEN);
      if (b.remaining !== null && b.remaining < need) {
        throw new AppException(ERROR_CODES.PLAN_LIMIT_REACHED, `Not enough AI credits left this month (${b.remaining} left; this needs up to ${need}). Credits renew on the 1st, or upgrade in Billing.`, HttpStatus.FORBIDDEN);
      }
      return this.db.aiRequest.create({ data: { userId, feature, courseId, reservedCredits: need } as never });
    });
    const started = Date.now();
    let result: AiResult<S extends z.ZodType ? z.infer<S> : never>;
    try {
      result = await this.ai.generate(call);
    } catch (e) {
      await this.db.aiRequest.update({ where: { id: req.id }, data: { status: 'FAILED', creditsCharged: 0, latencyMs: Date.now() - started, error: clip(String((e as Error).message), 500) } });
      throw e;
    }
    const charged = creditsFor(result.inputTokens, result.outputTokens, result.cachedTokens);
    const refused = result.stopReason === 'refusal';
    const unusable = !refused && call.schema !== undefined && result.output === null;
    await this.db.aiRequest.update({
      where: { id: req.id },
      data: {
        status: refused ? 'REFUSED' : unusable ? 'FAILED' : 'SUCCEEDED', model: result.model, creditsCharged: charged,
        inputTokens: result.inputTokens + result.cachedTokens, outputTokens: result.outputTokens, latencyMs: Date.now() - started,
        error: refused ? 'Declined by the model' : unusable ? `Unusable reply (${result.stopReason})` : null,
      },
    });
    if (refused) throw new AppException(ERROR_CODES.BAD_REQUEST, 'The AI declined this request. Try rephrasing it.', HttpStatus.UNPROCESSABLE_ENTITY);
    if (unusable) throw new AppException(ERROR_CODES.INTERNAL, result.stopReason === 'max_tokens' ? 'The AI reply was too long. Try asking for less at once.' : 'The AI reply could not be used. Please try again.', HttpStatus.BAD_GATEWAY);
    return { result, credits: charged };
  }

  private async academyName() {
    return (await this.prisma.tenant.findUniqueOrThrow({ where: { id: this.ctx.requireTenantId() }, select: { name: true } })).name;
  }

  // ── landing page ──────────────────────────────────────────
  /**
   * Landing page blocks from the academy's real profile, courses and the creator's own words.
   * Testimonials, ratings, learner counts, awards and guarantees are never generated; the stats
   * block is computed here from real enrolment data, and contact details come from the profile.
   */
  async landingPage(userId: string, input: LandingInput) {
    const tenantId = this.ctx.requireTenantId();
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { academy: true } });
    const business = await this.db.tenantBusinessProfile.findFirst({});
    const courses = await this.db.course.findMany({
      where: { status: 'PUBLISHED', visibility: 'PUBLIC', deletedAt: null }, orderBy: { publishedAt: 'desc' }, take: 30,
      select: { id: true, title: true, shortDescription: true, level: true, isFree: true, priceAmount: true, currency: true, accessType: true, accessDays: true, certificateEnabled: true, language: true },
    });
    const [learners, lessons] = await Promise.all([
      this.db.enrollment.groupBy({ by: ['userId'], where: { status: { in: ['ACTIVE', 'COMPLETED'] } } }).then((r) => r.length),
      this.db.courseLesson.count({ where: { isPublished: true, course: { status: 'PUBLISHED', deletedAt: null } } }),
    ]);
    const lang = LANGUAGES[input.language ?? 'en'] ?? 'English';
    const facts = {
      academy: { name: tenant.name, tagline: tenant.academy?.tagline ?? null, description: tenant.academy?.description ?? null },
      industry: input.industry, audience: input.audience ?? null, creatorHighlights: input.highlights ?? null,
      courses: courses.map((c) => ({
        id: c.id, title: c.title, summary: c.shortDescription, level: c.level, price: c.isFree ? 'free' : c.priceAmount ? `${c.priceAmount.toString()} ${c.currency}` : null,
        access: c.accessType === 'LIFETIME' ? 'lifetime access' : c.accessDays ? `${c.accessDays} days of access` : null, certificate: c.certificateEnabled, language: c.language,
      })),
      platformFacts: ['Learners study online on phone or computer', 'Payments by UPI, cards, net banking and wallets through Razorpay', ...(courses.some((c) => c.certificateEnabled) ? ['Some courses include a certificate on completion (see each course)'] : [])],
    };
    const { result, credits } = await this.run('LANDING_PAGE', userId, null, {
      system: [
        'You write the home page of an online academy run by an independent educator. Copy is specific to the academy and its courses, benefit-led and easy to scan; no clichés or filler.',
        'Use only the facts provided. Never invent testimonials, reviews, ratings, learner or student numbers, years of experience, awards, certifications, partnerships, results, guarantees, discounts or prices.',
        'FAQ answers must follow from the facts; leave out a question rather than guess. featuredCourseIds must be ids from the courses list (up to 6, best first); use an empty list when there are no courses.',
        'Limits: hero heading ≤ 80 characters, subheading ≤ 200, button labels ≤ 30, feature titles ≤ 60 and texts ≤ 200, 3–6 features, 2–4 about paragraphs, 3–6 FAQ items, SEO title ≤ 60, SEO description ≤ 155.',
        `Write everything in ${lang}. Tone: ${input.tone ?? 'friendly'}.`,
      ].join(' '),
      context: `Academy facts (JSON):\n${JSON.stringify(facts)}`,
      messages: [{ role: 'user', content: 'Write the landing page.' }],
      schema: LandingSchema,
      effort: 'medium',
      maxTokens: 8000,
    });
    const o = result.output!;
    const validIds = new Set(courses.map((c) => c.id));
    const featured = [...new Set(o.courses.featuredCourseIds.filter((id) => validIds.has(id)))].slice(0, 6);
    const para = (t: string) => ({ type: 'paragraph', content: t.trim() ? [{ type: 'text', text: clip(t, 2000) }] : [] });
    const blocks: { id: string; type: string; props: Record<string, unknown> }[] = [
      { id: 'hero', type: 'hero', props: { heading: clip(o.hero.heading, 120) || tenant.name, subheading: clip(o.hero.subheading, 300), ctaLabel: clip(o.hero.ctaLabel, 40) || 'Browse courses', ctaHref: '/courses', imageFileId: null, align: 'center' } },
    ];
    const stats = [
      ...(courses.length >= 2 ? [{ value: String(courses.length), label: 'Courses' }] : []),
      ...(lessons >= 10 ? [{ value: String(lessons), label: 'Lessons' }] : []),
      ...(learners >= 10 ? [{ value: `${learners}+`, label: 'Learners' }] : []),
    ];
    if (stats.length >= 2) blocks.push({ id: 'stats', type: 'stats', props: { items: stats } });
    const features = o.features.items.map((f) => ({ title: clip(f.title, 80), text: clip(f.text, 300) })).filter((f) => f.title).slice(0, 12);
    if (features.length) blocks.push({ id: 'features', type: 'features', props: { heading: clip(o.features.heading, 120), items: features } });
    if (courses.length) blocks.push({ id: 'courses', type: 'courseGrid', props: featured.length ? { heading: clip(o.courses.heading, 120), mode: 'selected', courseIds: featured, limit: 6 } : { heading: clip(o.courses.heading, 120), mode: 'all', courseIds: [], limit: 6 } });
    const about = o.about.paragraphs.filter((t) => t.trim()).slice(0, 6);
    if (about.length) blocks.push({ id: 'about', type: 'richText', props: { content: { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: clip(o.about.heading, 120) || `About ${tenant.name}` }] }, ...about.map(para)] } } });
    const faq = o.faq.items.map((f) => ({ q: clip(f.q, 200), a: clip(f.a, 2000) })).filter((f) => f.q && f.a).slice(0, 30);
    if (faq.length) blocks.push({ id: 'faq', type: 'faq', props: { heading: clip(o.faq.heading, 120), items: faq } });
    blocks.push({ id: 'cta', type: 'cta', props: { heading: clip(o.cta.heading, 120) || 'Start learning', text: clip(o.cta.text, 300), buttonLabel: clip(o.cta.buttonLabel, 40) || 'Browse courses', buttonHref: '/courses' } });
    const email = tenant.academy?.supportEmail ?? '';
    const address = [business?.city, business?.state].filter(Boolean).join(', ');
    if (email || address) blocks.push({ id: 'contact', type: 'contact', props: { heading: input.language === 'hi' ? 'संपर्क करें' : input.language === 'gu' ? 'સંપર્ક કરો' : 'Get in touch', email, phone: '', address } });
    return { blocks, seoTitle: clip(o.seoTitle, 70), seoDescription: clip(o.seoDescription, 170), credits };
  }

  // ── creator features ──────────────────────────────────────
  async courseOutline(userId: string, input: { courseId?: string; topic: string; audience?: string; level?: string; sections?: number }) {
    const course = input.courseId ? await this.courses.get(input.courseId) : null;
    const n = input.sections ?? 5;
    const { result, credits } = await this.run('COURSE_OUTLINE', userId, course?.id ?? null, {
      system: 'You design online courses for independent educators. Outlines are practical and ordered from fundamentals to application. Section and lesson titles are short and specific; each lesson summary is one sentence saying what the learner will be able to do after it. Write in the language of the topic description.',
      messages: [{ role: 'user', content: [`Course topic: ${input.topic}`, course ? `Course title: ${course.title}` : '', input.audience ? `Audience: ${input.audience}` : '', input.level ? `Level: ${input.level}` : '', `Create about ${n} sections with 2–6 lessons each.`].filter(Boolean).join('\n') }],
      schema: OutlineSchema,
      effort: 'medium',
      maxTokens: 8000,
    });
    const sections = result.output!.sections
      .map((s) => ({ title: clip(s.title, 200), lessons: s.lessons.map((l) => ({ title: clip(l.title, 200), summary: clip(l.summary, 1000) })).filter((l) => l.title).slice(0, 15) }))
      .filter((s) => s.title && s.lessons.length)
      .slice(0, 20);
    return { sections, credits };
  }

  /** Adds an outline to a course as draft (unpublished) text lessons; nothing is overwritten. */
  async applyOutline(courseId: string, outline: OutlineDraft) {
    await this.courses.get(courseId);
    let lessons = 0;
    for (const s of outline.sections) {
      const section = await this.courses.addSection(courseId, { title: clip(s.title, 200) } as never);
      for (const l of s.lessons) {
        const lesson = await this.courses.addLesson(courseId, { sectionId: section.id, title: clip(l.title, 200), type: 'TEXT' } as never);
        const content = l.summary.trim() ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: clip(l.summary, 1000) }] }] } : null;
        await this.db.courseLesson.update({ where: { id: lesson.id }, data: { isPublished: false, ...(content ? { content } : {}) } as never });
        lessons += 1;
      }
    }
    return { sections: outline.sections.length, lessons };
  }

  async lessonDraft(userId: string, input: { courseId: string; lessonId: string; notes?: string }) {
    const course = await this.courses.get(input.courseId);
    const lesson = await this.db.courseLesson.findFirst({ where: { id: input.lessonId, courseId: course.id }, include: { section: true } });
    if (!lesson) throw AppException.notFound('Lesson not found');
    const existing = richTextToPlain(lesson.content).trim();
    const { result, credits } = await this.run('LESSON_DRAFT', userId, course.id, {
      system: 'You write clear, friendly lesson content for online courses. Explain with concrete examples, short paragraphs and lists where they help. Start directly with the content (no title — the lesson title is shown separately) and end with a short recap. Use "heading" blocks for sub-topics; for lists put the items in "items" and an optional lead-in sentence in "text". Write in the language of the course.',
      messages: [{ role: 'user', content: [`Course: ${course.title}`, `Section: ${lesson.section.title}`, `Lesson: ${lesson.title}`, existing ? `Current notes for this lesson:\n${existing}` : '', input.notes ? `Instructions from the instructor: ${input.notes}` : ''].filter(Boolean).join('\n\n') }],
      schema: DraftSchema,
      effort: 'medium',
      maxTokens: 6000,
    });
    return { content: blocksToDoc(result.output!.blocks), credits };
  }

  async quizQuestions(userId: string, input: { courseId: string; sourceLessonId: string; count?: number }) {
    const course = await this.courses.get(input.courseId);
    const lesson = await this.db.courseLesson.findFirst({ where: { id: input.sourceLessonId, courseId: course.id } });
    if (!lesson) throw AppException.notFound('Lesson not found');
    const text = richTextToPlain(lesson.content).trim();
    if (text.length < 200) throw AppException.validation([{ field: 'sourceLessonId', message: 'This lesson has too little text to write questions from' }]);
    const count = input.count ?? 5;
    const { result, credits } = await this.run('QUIZ_QUESTIONS', userId, course.id, {
      system: 'You write multiple-choice quiz questions that check understanding of a lesson, using only facts stated in the lesson. Each question has 4 options with exactly one correct answer (correctIndex is 0-based); wrong options are plausible. The explanation says briefly why the answer is right. Write in the language of the lesson.',
      context: `Lesson: ${lesson.title}\n\n${text}`,
      messages: [{ role: 'user', content: `Write ${count} questions about this lesson.` }],
      schema: QuizSchema,
      effort: 'medium',
      maxTokens: 4000,
    });
    const questions = result.output!.questions
      .map((q) => ({ prompt: clip(q.prompt, 5000), options: q.options.map((o) => clip(o, 1000)).filter(Boolean), correctIndex: q.correctIndex, explanation: clip(q.explanation, 5000) }))
      .filter((q) => q.prompt && q.options.length >= 2 && q.options.length <= 6 && q.correctIndex >= 0 && q.correctIndex < q.options.length)
      .map((q) => ({ type: 'MCQ_SINGLE' as const, prompt: q.prompt, explanation: q.explanation || null, options: q.options.map((label, i) => ({ label, isCorrect: i === q.correctIndex })) }));
    return { questions, credits };
  }

  // ── tutor ─────────────────────────────────────────────────
  async tutorSettings() {
    const row = await this.db.tenantSetting.findFirst({ where: { key: TUTOR_KEY } });
    return { ...DEFAULT_TUTOR, ...((row?.value as object) ?? {}) } as typeof DEFAULT_TUTOR;
  }

  async saveTutorSettings(input: { enabled?: boolean; dailyLimit?: number }) {
    const value = { ...(await this.tutorSettings()), ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
    const tenantId = this.ctx.requireTenantId();
    await this.prisma.tenantSetting.upsert({ where: { tenantId_key: { tenantId, key: TUTOR_KEY } }, create: { tenantId, key: TUTOR_KEY, value }, update: { value } });
    return value;
  }

  private async tutorUsedToday(userId: string) {
    return this.db.aiRequest.count({ where: { userId, feature: 'TUTOR', status: { not: 'FAILED' }, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
  }

  async tutorStatus(userId: string) {
    const s = await this.tutorSettings();
    const enabled = s.enabled && this.ai.configured;
    return { enabled, remainingToday: enabled ? Math.max(0, s.dailyLimit - (await this.tutorUsedToday(userId))) : 0 };
  }

  async tutor(userId: string, input: { lessonId: string; question: string; history?: { role: 'user' | 'assistant'; content: string }[] }) {
    const s = await this.tutorSettings();
    if (!s.enabled) throw AppException.forbidden('The study assistant is not turned on for this academy.');
    const { lesson } = await this.learning.accessibleLesson(userId, input.lessonId);
    if ((await this.tutorUsedToday(userId)) >= s.dailyLimit) throw new AppException(ERROR_CODES.RATE_LIMITED, `You've reached today's limit of ${s.dailyLimit} questions. Try again tomorrow.`, HttpStatus.TOO_MANY_REQUESTS);
    const history = (input.history ?? []).slice(-6);
    if (history.length && history[0].role !== 'user') history.shift();
    for (let i = 1; i < history.length; i++) if (history[i].role === history[i - 1].role) throw AppException.validation([{ field: 'history', message: 'Turns must alternate' }]);
    if (history.at(-1)?.role === 'user') history.pop();
    const course = (lesson as { course: { title: string } }).course;
    const text = richTextToPlain(lesson.content).trim();
    const { result, credits } = await this.run('TUTOR', userId, lesson.courseId, {
      system: `You are the study assistant for the course "${course.title}" at ${await this.academyName()}. Help the student understand the lesson provided. Base answers on the lesson; if a question goes beyond it, say so, and only give a brief general answer when it is closely related. Guide students through assignments and quizzes rather than giving the answers. Keep answers short and in plain text, in the student's language.`,
      context: `Lesson: ${lesson.title}\n\n${text || '(This lesson has no text content; it may be a video or a file.)'}`,
      messages: [...history.map((h) => ({ role: h.role, content: clip(h.content, 4000) })), { role: 'user', content: input.question }],
      effort: 'low',
      maxTokens: 2000,
    });
    void credits;
    return { answer: result.text.trim(), remainingToday: Math.max(0, s.dailyLimit - (await this.tutorUsedToday(userId))) };
  }
}
