#!/bin/sh

set -eu

missing=""

if [ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" ]; then
  missing="${missing} NEXT_PUBLIC_SUPABASE_URL"
fi

if [ -z "${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:-}" ]; then
  missing="${missing} NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
fi

if [ -z "${SUPABASE_SERVER_URL:-}" ]; then
  missing="${missing} SUPABASE_SERVER_URL"
fi

if [ -z "${FIELD_ENCRYPTION_KEY:-}" ]; then
  missing="${missing} FIELD_ENCRYPTION_KEY"
fi

if [ -n "$missing" ]; then
  echo "CatWallet startup aborted: missing required environment variables:${missing}" >&2
  exit 78
fi

exec "$@"
