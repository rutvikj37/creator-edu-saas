import { Inject, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { LiveService } from './live.service.js';

type Who = { userId: string | null; registrationId: string | null; staff: boolean; name: string };

/** Polls and Q&A during a session (stored, so hosts can review them afterwards). */
@Injectable()
export class LiveInteractionService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly live: LiveService,
  ) {}

  private notEnded(status: string) {
    if (status === 'ENDED' || status === 'CANCELLED') throw AppException.conflict('This session is over.');
  }

  async polls(sessionId: string, who: Who) {
    const { identity } = await this.live.participant(sessionId, who);
    const polls = await this.db.livePoll.findMany({ where: { sessionId }, include: { votes: true }, orderBy: { createdAt: 'desc' } });
    return polls.map((p) => {
      const options = p.options as string[];
      const counts = options.map((_, i) => p.votes.filter((v) => v.optionIndex === i).length);
      return { id: p.id, question: p.question, options, status: p.status, counts, total: p.votes.length, myVote: p.votes.find((v) => v.identity === identity)?.optionIndex ?? null, createdAt: p.createdAt };
    });
  }

  async createPoll(sessionId: string, who: Who, question: string, options: string[]) {
    const { session, host } = await this.live.participant(sessionId, who);
    if (!host) throw AppException.forbidden('Only the host can create polls.');
    this.notEnded(session.status);
    const clean = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim() || clean.length < 2 || clean.length > 6 || clean.some((o) => o.length > 100)) throw AppException.validation([{ field: 'options', message: 'Ask a question with 2–6 options of up to 100 characters' }]);
    await this.db.livePoll.create({ data: { sessionId, question: question.trim().slice(0, 300), options: clean } as never });
    return this.polls(sessionId, who);
  }

  async vote(sessionId: string, pollId: string, who: Who, optionIndex: number) {
    const { session, identity } = await this.live.participant(sessionId, who);
    this.notEnded(session.status);
    const poll = await this.db.livePoll.findFirst({ where: { id: pollId, sessionId } });
    if (!poll) throw AppException.notFound('Poll not found');
    if (poll.status !== 'OPEN') throw AppException.conflict('This poll is closed.');
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= (poll.options as string[]).length) throw AppException.validation([{ field: 'optionIndex', message: 'Choose an option' }]);
    const existing = await this.db.livePollVote.findFirst({ where: { pollId, identity } });
    if (existing) await this.db.livePollVote.update({ where: { id: existing.id }, data: { optionIndex } });
    else await this.db.livePollVote.create({ data: { pollId, identity, optionIndex } as never });
    return this.polls(sessionId, who);
  }

  async closePoll(sessionId: string, pollId: string, who: Who) {
    const { host } = await this.live.participant(sessionId, who);
    if (!host) throw AppException.forbidden('Only the host can close polls.');
    const r = await this.db.livePoll.updateMany({ where: { id: pollId, sessionId }, data: { status: 'CLOSED', closedAt: new Date() } });
    if (!r.count) throw AppException.notFound('Poll not found');
    return this.polls(sessionId, who);
  }

  async questions(sessionId: string, who: Who) {
    const { identity } = await this.live.participant(sessionId, who);
    const rows = await this.db.liveQuestion.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });
    return rows
      .map((q) => {
        const up = q.upvotes as string[];
        return { id: q.id, name: q.name, text: q.text, upvotes: up.length, upvotedByMe: up.includes(identity), mine: q.identity === identity, answered: Boolean(q.answeredAt), createdAt: q.createdAt };
      })
      .sort((a, b) => Number(a.answered) - Number(b.answered) || b.upvotes - a.upvotes);
  }

  async ask(sessionId: string, who: Who, text: string) {
    const { session, identity } = await this.live.participant(sessionId, who);
    this.notEnded(session.status);
    const t = text.trim();
    if (!t || t.length > 500) throw AppException.validation([{ field: 'text', message: '1–500 characters' }]);
    const recent = await this.db.liveQuestion.count({ where: { sessionId, identity, createdAt: { gt: new Date(Date.now() - 60_000) } } });
    if (recent >= 5) throw AppException.conflict('You are asking too quickly. Please wait a moment.');
    await this.db.liveQuestion.create({ data: { sessionId, identity, name: who.name.slice(0, 120), text: t, upvotes: [] } as never });
    return this.questions(sessionId, who);
  }

  async upvote(sessionId: string, questionId: string, who: Who) {
    const { identity } = await this.live.participant(sessionId, who);
    const q = await this.db.liveQuestion.findFirst({ where: { id: questionId, sessionId } });
    if (!q) throw AppException.notFound('Question not found');
    const up = q.upvotes as string[];
    await this.db.liveQuestion.update({ where: { id: q.id }, data: { upvotes: up.includes(identity) ? up.filter((x) => x !== identity) : [...up, identity] } });
    return this.questions(sessionId, who);
  }

  async answer(sessionId: string, questionId: string, who: Who) {
    const { host } = await this.live.participant(sessionId, who);
    if (!host) throw AppException.forbidden('Only the host can mark questions answered.');
    const r = await this.db.liveQuestion.updateMany({ where: { id: questionId, sessionId }, data: { answeredAt: new Date() } });
    if (!r.count) throw AppException.notFound('Question not found');
    return this.questions(sessionId, who);
  }
}
