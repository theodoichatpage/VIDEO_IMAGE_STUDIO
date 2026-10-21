# Vercel migration

Set this directory as the Vercel Root Directory after the migration branch has been merged.

Required Vercel environment variables:
- SUPABASE_URL
- SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)

Run `supabase/schema.sql` once in Supabase SQL Editor before production use.

