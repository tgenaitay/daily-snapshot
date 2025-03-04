import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { createClient } from '@supabase/supabase-js';

// Only load dotenv if running locally (optional)
if (process.env.NODE_ENV !== 'production') {
  const dotenv = await import('dotenv');
  dotenv.config();
}
chromium.use(stealth());

// Use environment variables directly (from GitHub Secrets or .env)
const supabase = createClient(
  process.env.SUPABASE_URL.trim(),
  process.env.SUPABASE_ANON_KEY.trim(),
  {
    auth: {
      persistSession: false
    }
  }
);

// Configuration arrays for fingerprint variation
const USER_AGENTS = [
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    platform: 'Win32'
  },
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    platform: 'MacIntel'
  },
  {
    ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    platform: 'Linux x86_64'
  },
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
    platform: 'Win32'
  }
];

const LOCALES = ['en-US', 'en-GB', 'en-CA'];
const TIMEZONES = ['America/New_York', 'Europe/London', 'Asia/Tokyo'];

export class SnapshotService {
  async captureSnapshot(url) {
    // Check if a snapshot was already taken today
    const today = new Date().toISOString().split('T')[0];
    const { data: existingSnapshots } = await supabase
      .from('dom_snapshots')
      .select('captured_at')
      .eq('url', url)
      .gte('captured_at', today)
      .lt('captured_at', today + 'T23:59:59.999Z');

    if (existingSnapshots && existingSnapshots.length > 0) {
      const error = new Error('A snapshot has already been taken today for this URL');
      error.code = 'DUPLICATE_SNAPSHOT';
      console.error(`Skipping ${url}: already captured today`);
      throw error;
    }

    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox'
      ]
    });

    let content = null;
    let retryCount = 0;
    const MAX_RETRIES = 5;
    console.log(`Let's go with ${url}...`);
    while (retryCount < MAX_RETRIES && !content) {

      const selected = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
      const userAgent = selected.ua;
      const platform = selected.platform;
      const viewportWidth = 1920 + Math.floor(Math.random() * 100 - 50);
      const viewportHeight = 1080 + Math.floor(Math.random() * 60 - 30);
      const locale = LOCALES[Math.floor(Math.random() * LOCALES.length)];
      const timezone = TIMEZONES[Math.floor(Math.random() * TIMEZONES.length)];

      console.log(`Attempt ${retryCount + 1}: Using UA: ${userAgent.substring(0, 50)}..., Viewport: ${viewportWidth}x${viewportHeight}, Locale: ${locale}, Timezone: ${timezone}`);

      const context = await browser.newContext({
        userAgent,
        viewport: { width: viewportWidth, height: viewportHeight },
        locale,
        timezoneId: timezone,
        colorScheme: Math.random() > 0.5 ? 'light' : 'dark',
        permissions: ['geolocation'],
        bypassCSP: true,
        ignoreHTTPSErrors: true
      });

      // Advanced fingerprint evasion
      await context.addInitScript((platform) => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', {
          get: () => [{
            description: 'Portable Document Format',
            filename: 'internal-pdf-viewer',
            name: 'PDF Viewer'
          }]
        });
        Object.defineProperty(navigator, 'languages', {
          get: () => [locale.split('-')[0], locale]
        });
        Object.defineProperty(navigator, 'platform', {
          get: () => platform
        });
      }, platform);

      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        const pageContent = await page.content();
        const dom = new JSDOM(pageContent);
        const title = dom.window.document.title || 'Unknown Title';        
        // Use Readability extraction
        const reader = new Readability(dom.window.document, {
          charThreshold: 500,
          keepClasses: false
        });
        const article = reader.parse();

        if (article) {
          content = JSON.stringify({
            title: article.title || title,
            textContent: article.textContent,
            length: article.length
          });
        } else {
          // Fallback to basic text extraction
          const fallbackContent = dom.window.document.body.textContent.trim();
          content = JSON.stringify({
            title: title,
            textContent: fallbackContent,
            length: fallbackContent.length
          });
        }

        if (content) {
          console.log(`Content = ${content.substring(0, 50)}...`);
        }
      } catch (error) {
        console.error(`Failed to capture content on attempt ${retryCount + 1}:`, error);
        retryCount++;
        await page.close();
        await context.close();
        continue;
      }
    }

    await browser.close();

    if (!content) {
      throw new Error(`Failed to capture content after ${MAX_RETRIES} attempts`);
    }

  // Insert snapshot and update last_snapshot_at
  const capturedAt = new Date().toISOString();
  const { data: snapshotData, error: insertError } = await supabase
    .from('dom_snapshots')
    .insert({
      url,
      content,
      captured_at: capturedAt
    })
    .select()
    .single();

  if (insertError) throw insertError;

  // Update last_snapshot_at in sources table
  const { error: updateError } = await supabase
    .from('sources')
    .update({ last_snapshot_at: capturedAt })
    .eq('url', url);

  if (updateError) {
    console.error(`Failed to update last_snapshot_at for ${url}:`, updateError);
    throw updateError;
  }

  return snapshotData;
  }
}