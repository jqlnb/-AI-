import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: cors });
  const authorization = req.headers.get('Authorization');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authorization || !serviceKey) return Response.json({ error: 'configuration_or_authentication_required' }, { status: 401, headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return Response.json({ error: 'authentication_required' }, { status: 401, headers: cors });
  const admin = createClient(url, serviceKey);
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) return Response.json({ error: 'account_deletion_failed' }, { status: 500, headers: cors });
  return Response.json({ deleted: true }, { headers: { ...cors, 'Cache-Control': 'no-store' } });
});
