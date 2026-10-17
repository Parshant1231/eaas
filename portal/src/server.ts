import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createAwsReader } from './aws.js';
import { createInjectClient } from './inject-client.js';
import { createJenkinsClient } from './jenkins.js';
import { createDestroyQueue } from './sqs.js';
import { isValidOwner } from './validation.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name} (see .env.example)`);
  return value;
}

// Required on purpose: without it the AWS SDK would silently fall back to the default (admin) credentials
required('AWS_PROFILE');

const port = Number(process.env.PORT ?? 3000);
const region = process.env.AWS_REGION ?? 'ap-south-1';
const owner = process.env.PORTAL_OWNER ?? 'kelvrix';
if (!isValidOwner(owner)) throw new Error('PORTAL_OWNER must be 3-31 chars: lowercase letters, digits, hyphens');

const jenkinsUrl = required('JENKINS_URL').replace(/\/+$/, '');
const jenkinsUser = required('JENKINS_USER');
const jenkinsToken = required('JENKINS_API_TOKEN');

const queueUrl = process.env.REAPER_QUEUE_URL?.trim() || undefined;
if (queueUrl !== undefined && !/^https:\/\/sqs\.[a-z0-9-]+\.amazonaws\.com\/\d{12}\/[A-Za-z0-9_-]{1,80}$/.test(queueUrl)) {
  throw new Error('REAPER_QUEUE_URL does not look like an SQS queue URL');
}
if (queueUrl === undefined) {
  console.log('TTL poller disabled: REAPER_QUEUE_URL is not set (the Lambda backstop still terminates instances)');
}

const app = createApp({
  jenkins: createJenkinsClient({
    baseUrl: jenkinsUrl,
    user: jenkinsUser,
    token: jenkinsToken,
    createJob: 'eaas-create',
    destroyJob: 'eaas-destroy',
    injectJob: 'eaas-inject',
  }),
  aws: createAwsReader(region),
  queue: queueUrl !== undefined ? createDestroyQueue(region, queueUrl) : undefined,
  injector: createInjectClient({ baseUrl: jenkinsUrl, user: jenkinsUser, token: jenkinsToken, job: 'eaas-inject' }),
  config: {
    owner,
    maxEnvironments: 3,
    publicDir: fileURLToPath(new URL('../public', import.meta.url)),
  },
});

app.listen(port, '127.0.0.1', () => {
  console.log(`EaaS portal listening on http://localhost:${port} (bound to 127.0.0.1 only)`);
});
