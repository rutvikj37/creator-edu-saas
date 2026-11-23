// Adds the LMS's CORS rule to the S3 bucket (browser uploads/downloads via presigned URLs),
// keeping any rules the bucket already has. Usage: node s3-cors.mjs [--apply]  (reads /opt/lms/shared/.env)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/opt/lms/current/apps/api/package.json');
const { S3Client, GetBucketCorsCommand, PutBucketCorsCommand } = require('@aws-sdk/client-s3');

const env = Object.fromEntries(readFileSync('/opt/lms/shared/.env', 'utf8').split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]));
const s3 = new S3Client({ region: env.AWS_REGION, credentials: { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY } });
const Bucket = env.S3_PRIVATE_BUCKET;
const LMS_RULE = {
  ID: 'techx-lms',
  // Academies can use their own domains, and every request is a presigned URL, so any origin is allowed.
  AllowedOrigins: ['*'],
  AllowedMethods: ['GET', 'PUT', 'HEAD'],
  AllowedHeaders: ['*'],
  ExposeHeaders: ['ETag', 'Content-Length', 'Content-Range'],
  MaxAgeSeconds: 3600,
};

let existing = [];
try {
  existing = (await s3.send(new GetBucketCorsCommand({ Bucket }))).CORSRules ?? [];
} catch (e) {
  if (e.name !== 'NoSuchCORSConfiguration') throw e;
}
console.log(`bucket ${Bucket}: ${existing.length} existing CORS rule(s)`, JSON.stringify(existing));
const rules = [...existing.filter((r) => r.ID !== LMS_RULE.ID), LMS_RULE];
if (process.argv.includes('--apply')) {
  await s3.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules: rules } }));
  console.log(`applied: ${rules.length} rule(s)`);
}
