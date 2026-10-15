import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createAwsReader } from './aws.js';
import { createJenkinsClient } from './jenkins.js';
import { isValidOwner } from './validation.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name} (see .env.example)`);
  return value;
}

// Required on purpose: without it the AWS SDK would silently fall back to the default (admin) credentials
required('AWS_PROFILE');

const port = Number(process.env.PORT ?? 3000);
const owner = process.env.PORTAL_OWNER ?? 'kelvrix';
if (!isValidOwner(owner)) throw new Error('PORTAL_OWNER must be 3-31 chars: lowercase letters, digits, hyphens');

const app = createApp({
  jenkins: createJenkinsClient({
    baseUrl: required('JENKINS_URL').replace(/\/+$/, ''),
    user: required('JENKINS_USER'),
    token: required('JENKINS_API_TOKEN'),
    createJob: 'eaas-create',
    destroyJob: 'eaas-destroy',
  }),
  aws: createAwsReader(process.env.AWS_REGION ?? 'ap-south-1'),
  config: {
    owner,
    maxEnvironments: 3,
    publicDir: fileURLToPath(new URL('../public', import.meta.url)),
  },
});

app.listen(port, '127.0.0.1', () => {
  console.log(`EaaS portal listening on http://localhost:${port} (bound to 127.0.0.1 only)`);
});
