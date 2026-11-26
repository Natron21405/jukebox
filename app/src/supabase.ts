import { createClient } from '@supabase/supabase-js';

// Only the publishable (anon) key is ever shipped to the browser.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
