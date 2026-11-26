import { AppException } from '../../common/errors/app-exception.js';
import type { PrismaService } from '../../core/prisma/prisma.service.js';

export const FIELD_TYPES = ['TEXT', 'NUMBER', 'DATE', 'SELECT', 'CHECKBOX'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
type Field = { id: string; label: string; type: string; options: unknown; required: boolean; editable: boolean; showInSignup: boolean; askBeforeCourse: boolean };

export const fieldView = (f: Field & { position: number }) => ({
  id: f.id, label: f.label, type: f.type, options: Array.isArray(f.options) ? f.options : [], required: f.required, editable: f.editable,
  showInSignup: f.showInSignup, askBeforeCourse: f.askBeforeCourse, position: f.position,
});

/** Normalises one answer for its field type; throws a field error naming the field when it is not valid. */
export function normaliseValue(f: Field, raw: unknown): string | null {
  const v = raw === null || raw === undefined ? '' : String(raw).trim();
  const fail = (message: string) => { throw AppException.validation([{ field: `customFields.${f.id}`, message }]); };
  if (!v) return null;
  if (v.length > 500) fail(`${f.label}: up to 500 characters`);
  if (f.type === 'NUMBER' && !/^-?\d+(\.\d+)?$/.test(v)) fail(`${f.label}: enter a number`);
  if (f.type === 'DATE' && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)))) fail(`${f.label}: enter a date`);
  if (f.type === 'SELECT' && !(Array.isArray(f.options) && f.options.includes(v))) fail(`${f.label}: choose one of the options`);
  if (f.type === 'CHECKBOX' && v !== 'true' && v !== 'false') fail(`${f.label}: yes or no`);
  return v;
}

/**
 * Saves a learner's answers. `scope` decides which fields must be answered now: the sign-up form's
 * required fields, or (from the profile / before-course prompt) every required field sent.
 * Answers to fields that can't be edited after submission are kept once given.
 */
export async function saveFieldValues(prisma: PrismaService, tenantId: string, userId: string, input: Record<string, unknown> | undefined, scope: 'signup' | 'profile') {
  const fields = await prisma.customField.findMany({ where: { tenantId } });
  const existing = await prisma.customFieldValue.findMany({ where: { tenantId, userId } });
  const answers = input ?? {};
  for (const f of fields) {
    const sent = Object.prototype.hasOwnProperty.call(answers, f.id);
    const required = f.required && (scope === 'signup' ? f.showInSignup : sent);
    if (!sent && !required) continue;
    const value = normaliseValue(f, answers[f.id]);
    if (required && (value === null || (f.type === 'CHECKBOX' && value === 'false' && f.required))) {
      throw AppException.validation([{ field: `customFields.${f.id}`, message: `${f.label} is required` }]);
    }
    const prior = existing.find((e) => e.fieldId === f.id);
    if (prior && !f.editable) continue;
    if (value === null) { if (prior) await prisma.customFieldValue.delete({ where: { id: prior.id } }); continue; }
    await prisma.customFieldValue.upsert({
      where: { tenantId_fieldId_userId: { tenantId, fieldId: f.id, userId } },
      create: { tenantId, fieldId: f.id, userId, value },
      update: { value },
    });
  }
}

/** Fields with the learner's answers, and whether a required before-course question is still open. */
export async function fieldsForLearner(prisma: PrismaService, tenantId: string, userId: string) {
  const [fields, values] = await Promise.all([
    prisma.customField.findMany({ where: { tenantId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
    prisma.customFieldValue.findMany({ where: { tenantId, userId } }),
  ]);
  const items = fields.map((f) => ({ ...fieldView(f), value: values.find((v) => v.fieldId === f.id)?.value ?? null }));
  return { fields: items, beforeCourse: items.filter((f) => f.askBeforeCourse && f.value === null && (f.required || true)) };
}
