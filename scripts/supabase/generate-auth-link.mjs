import { createClient } from '@supabase/supabase-js';

const VALID_TYPES = new Set(['magiclink', 'invite']);

function printHelp() {
  console.log(`Usage:
  node scripts/supabase/generate-auth-link.mjs --email <email> [--type magiclink|invite] [--redirect-to <url>] [--json]

Options:
  --email         Required. Target email address.
  --type          Optional. Either "magiclink" or "invite". Defaults to "magiclink".
  --redirect-to   Optional. Redirect URL appended to the generated link.
  --json          Optional. Print the full response as JSON.
  --help          Show this help message.

Environment variables:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Examples:
  node scripts/supabase/generate-auth-link.mjs --email member@example.com
  node scripts/supabase/generate-auth-link.mjs --email member@example.com --redirect-to http://localhost:5173/lawdata-app-vite/
  node scripts/supabase/generate-auth-link.mjs --email member@example.com --type invite --json`);
}

function parseArgs(argv) {
  const options = {
    email: '',
    type: 'magiclink',
    redirectTo: '',
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--email') {
      const value = argv[i + 1];
      if (!value) throw new Error('--email requires a value.');
      options.email = value.trim();
      i += 1;
      continue;
    }
    if (arg === '--type') {
      const value = argv[i + 1];
      if (!value || !VALID_TYPES.has(value)) {
        throw new Error('--type must be either "magiclink" or "invite".');
      }
      options.type = value;
      i += 1;
      continue;
    }
    if (arg === '--redirect-to') {
      const value = argv[i + 1];
      if (!value) throw new Error('--redirect-to requires a value.');
      options.redirectTo = value.trim();
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function buildParams({ email, type, redirectTo }) {
  const params = {
    type,
    email,
  };

  if (redirectTo) {
    params.options = { redirectTo };
  }

  return params;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.email) {
    throw new Error('--email is required.');
  }

  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data, error } = await admin.auth.admin.generateLink(buildParams(options));
  if (error) {
    throw new Error(error.message);
  }

  if (!data?.properties?.action_link) {
    throw new Error('Supabase did not return an action_link.');
  }

  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(`type=${options.type}`);
  console.log(`email=${options.email}`);
  console.log(`redirect_to=${data.properties.redirect_to || '(Supabase Site URL)'}`);
  console.log(`verification_type=${data.properties.verification_type}`);
  console.log('');
  console.log(data.properties.action_link);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
