import { createClient } from '@supabase/supabase-js';

// Conditional dotenv for local dev only
if (process.env.NODE_ENV !== 'production') {
  import('dotenv').then(dotenv => dotenv.config());
}

const supabase = createClient(
  process.env.SUPABASE_URL.trim(),
  process.env.SUPABASE_ANON_KEY.trim(),
  {
    auth: {
      persistSession: false
    }
  }
);

export class SourceService {
  async listSources(includeTotal = false) {
    let query = supabase.from('sources');
    
    if (includeTotal) {
      query = query.select(`
        *,
        dom_snapshots:dom_snapshots!url(count)
      `);
    } else {
      query = query.select('*');
    }
  
    // Explicitly filter for active sources
    query = query.eq('is_active', true);
  
    const { data, error } = await query.order('last_snapshot_at', { ascending: false });
  
    if (error) throw error;
    return data;
  }
}