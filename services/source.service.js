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

  async addSource(url) {
    const source = {
      url,
      is_active: true,
      last_snapshot_at: null
    };

    const { data, error } = await supabase
      .from('sources')
      .insert([source])
      .select();

    if (error) throw error;
    return data[0];
  }

  async updateSourceStatus(url, isActive) {
    const { data, error } = await supabase
      .from('sources')
      .update({ is_active: isActive })
      .eq('url', url)
      .select();

    if (error) throw error;
    return data[0];
  }

  async deleteSource(id) {
    const { data, error } = await supabase
      .from('sources')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return { message: 'Source deleted successfully' };
  }
}