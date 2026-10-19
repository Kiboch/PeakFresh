const SUPABASE_URL = "https://hjdwpivldpnejenwplqb.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_XO-qTa9t4vbIwFQlI5o19Q_2oEAX2L1";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);