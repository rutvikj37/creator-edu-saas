import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import { ERROR_CODES } from '@ce/shared';
import { AppException } from '../../common/errors/app-exception.js';
import { AppConfig } from '../../config/app-config.service.js';

export type Effort = 'low' | 'medium' | 'high';

export interface AiCall<S extends z.ZodType | undefined> {
  /** Stable instructions first (cacheable), then optional per-call context. */
  system: string;
  /** Large context reused across calls (e.g. a lesson's text for the tutor); cached. */
  context?: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  schema?: S;
  effort: Effort;
  maxTokens: number;
}

export interface AiResult<T> {
  output: T | null;
  text: string;
  model: string;
  /** Uncached input incl. cache writes. */
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  stopReason: string | null;
}

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`) on the Claude API. */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

/**
 * Thin wrapper over the official Anthropic SDK. It is the only place that talks to Claude, so tests
 * replace it (like PaymentHttp for Razorpay). Without ANTHROPIC_API_KEY, AI features report
 * "not configured" instead of failing silently.
 */
@Injectable()
export class AiClient {
  private readonly log = new Logger(AiClient.name);
  private readonly client: Anthropic | null;
  readonly model: string;

  constructor(config: AppConfig) {
    const key = config.get('ANTHROPIC_API_KEY');
    this.model = config.get('ANTHROPIC_MODEL') || 'claude-opus-5-5';
    this.client = key ? new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120_000 }) : null;
  }

  get configured() {
    return this.client !== null;
  }

  async generate<S extends z.ZodType | undefined = undefined>(call: AiCall<S>): Promise<AiResult<S extends z.ZodType ? z.infer<S> : never>> {
    if (!this.client) throw new AppException(ERROR_CODES.INTEGRATION_NOT_CONFIGURED, 'AI features are not set up on this platform yet.', HttpStatus.SERVICE_UNAVAILABLE);
    const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: 'text', text: call.system }];
    if (call.context) system.push({ type: 'text', text: call.context, cache_control: { type: 'ephemeral' } });
    const fallback = FALLBACK_MODELS.has(this.model);
    const params = {
      model: this.model,
      max_tokens: call.maxTokens,
      system,
      messages: call.messages,
      ...(fallback ? { betas: ['server-side-fallback-2026-07-01'] as Anthropic.Beta.AnthropicBeta[], fallbacks: 'default' as const } : {}),
    };
    try {
      // create() + our own parse (rather than parse()) so token usage is still known — and
      // credits settled — when a refused or truncated reply does not match the schema.
      const format = call.schema ? betaZodOutputFormat(call.schema) : null;
      const res = await this.client.beta.messages.create({ ...params, output_config: { effort: call.effort, ...(format ? { format } : {}) } });
      const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      let output = null;
      if (format && res.stop_reason === 'end_turn') {
        try {
          output = format.parse(text);
        } catch {
          this.log.warn('Structured output did not match the schema');
        }
      }
      const u = res.usage;
      return {
        output: output as never,
        text,
        model: res.model,
        inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
        cachedTokens: u.cache_read_input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        stopReason: res.stop_reason,
      };
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError) {
        throw new AppException(ERROR_CODES.RATE_LIMITED, 'The AI service is busy. Please try again in a minute.', HttpStatus.SERVICE_UNAVAILABLE);
      }
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
        this.log.error(`Anthropic rejected the platform credentials: ${e.message}`);
        throw new AppException(ERROR_CODES.INTEGRATION_NOT_CONFIGURED, 'AI is not available right now (platform configuration). Our team has been notified.', HttpStatus.SERVICE_UNAVAILABLE);
      }
      if (e instanceof Anthropic.APIError) {
        this.log.error(`Anthropic API error ${e.status}: ${e.message}`);
        throw new AppException(ERROR_CODES.INTERNAL, 'The AI request failed. Please try again.', HttpStatus.BAD_GATEWAY);
      }
      throw e;
    }
  }
}
