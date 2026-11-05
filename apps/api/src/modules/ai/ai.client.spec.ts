import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { AiClient } from './ai.client.js';

/** Runs the real Anthropic SDK against a local stand-in for api.anthropic.com. */
describe('AiClient (official SDK, local fake API)', () => {
  let server: Server;
  let requests: { headers: Record<string, unknown>; body: any }[] = [];
  let respond: (body: any) => { status: number; json: unknown } = () => ({ status: 500, json: {} });
  const client = (key: string | undefined = 'sk-ant-test', model = 'claude-opus-5-5') => new AiClient({ get: (k: string) => (k === 'ANTHROPIC_API_KEY' ? key : k === 'ANTHROPIC_MODEL' ? model : undefined) } as never);
  const message = (content: unknown[], stop = 'end_turn', usage = { input_tokens: 120, output_tokens: 80, cache_creation_input_tokens: 30, cache_read_input_tokens: 500 }) => ({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason: stop, stop_sequence: null, usage,
  });

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = JSON.parse(raw || '{}');
        requests.push({ headers: req.headers, body });
        const r = respond(body);
        res.writeHead(r.status, { 'content-type': 'application/json', 'request-id': 'req_test' });
        res.end(JSON.stringify(r.json));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { delete process.env.ANTHROPIC_BASE_URL; server.close(); });
  beforeEach(() => { requests = []; });

  it('reports not configured without a key', async () => {
    const c = client('');
    expect(c.configured).toBe(false);
    await expect(c.generate({ system: 's', messages: [{ role: 'user', content: 'hi' }], effort: 'low', maxTokens: 100 })).rejects.toMatchObject({ code: 'INTEGRATION_NOT_CONFIGURED' });
  });

  it('sends structured output, effort, cached context and the refusal fallback; parses the reply and usage', async () => {
    respond = () => ({ status: 200, json: message([{ type: 'text', text: '{"title":"Budgeting","n":3}' }]) });
    const r = await client().generate({ system: 'Be brief.', context: 'Lesson text', messages: [{ role: 'user', content: 'Go' }], schema: z.object({ title: z.string(), n: z.number() }), effort: 'medium', maxTokens: 4000 });
    expect(r).toEqual({ output: { title: 'Budgeting', n: 3 }, text: '{"title":"Budgeting","n":3}', model: 'claude-opus-5-5', inputTokens: 150, cachedTokens: 500, outputTokens: 80, stopReason: 'end_turn' });
    const { headers, body } = requests[0];
    expect(headers.authorization).toBe('Bearer sk-ant-test'); // SDK 1.x sends API keys as a bearer token
    expect(String(headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01');
    expect(body).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 4000, fallbacks: 'default', output_config: { effort: 'medium', format: { type: 'json_schema' } } });
    expect(body.output_config.format.schema).toMatchObject({ type: 'object', required: ['title', 'n'] });
    expect(body.system).toEqual([{ type: 'text', text: 'Be brief.' }, { type: 'text', text: 'Lesson text', cache_control: { type: 'ephemeral' } }]);
    expect(body.thinking).toBeUndefined(); // adaptive by default on this model; effort controls depth
  });

  it('keeps usage when the reply is refused or does not match the schema', async () => {
    respond = () => ({ status: 200, json: message([], 'refusal') });
    const refused = await client().generate({ system: 's', messages: [{ role: 'user', content: 'x' }], schema: z.object({ a: z.string() }), effort: 'low', maxTokens: 100 });
    expect(refused).toMatchObject({ output: null, stopReason: 'refusal', outputTokens: 80 });
    respond = () => ({ status: 200, json: message([{ type: 'text', text: '{"a":1}' }]) });
    expect((await client().generate({ system: 's', messages: [{ role: 'user', content: 'x' }], schema: z.object({ a: z.string() }), effort: 'low', maxTokens: 100 })).output).toBeNull();
  });

  it('omits the fallback for models that do not support it, and maps API errors', async () => {
    respond = () => ({ status: 200, json: message([{ type: 'text', text: 'ok' }]) });
    await client(undefined, 'claude-haiku-5-5').generate({ system: 's', messages: [{ role: 'user', content: 'x' }], effort: 'low', maxTokens: 100 });
    expect(requests[0].body.fallbacks).toBeUndefined();
    respond = () => ({ status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } });
    await expect(client().generate({ system: 's', messages: [{ role: 'user', content: 'x' }], effort: 'low', maxTokens: 100 })).rejects.toMatchObject({ code: 'INTEGRATION_NOT_CONFIGURED' });
    respond = () => ({ status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: 'bad' } } });
    await expect(client().generate({ system: 's', messages: [{ role: 'user', content: 'x' }], effort: 'low', maxTokens: 100 })).rejects.toMatchObject({ code: 'INTERNAL' });
  }, 20_000);
});
