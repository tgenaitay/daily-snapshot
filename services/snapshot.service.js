import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { createClient } from '@supabase/supabase-js';
import minifyHtml from '@minify-html/node';

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
        // '--disable-blink-features=AutomationControlled',
        // '--disable-features=IsolateOrigins,site-per-process',
        '--no-sandbox'
        // '--disable-web-security',
        // '--disable-dev-shm-usage',
        // '--disable-accelerated-2d-canvas',
        // '--disable-gpu',
        // '--hide-scrollbars'
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
        const reader = new Readability(dom.window.document, {
          charThreshold: 500, // Minimum content length
          keepClasses: false // Disable class retention
        });
        const changes = reader.parse();

        if (changes) {
          changes.content = minifyHtml.minify(Buffer.from(changes.content), {
            keep_spaces_between_attributes: false,
            keep_comments: false
          }).toString();
          content = JSON.stringify(changes);
        } else {
          content = minifyHtml.minify(Buffer.from(pageContent), {
            keep_spaces_between_attributes: false,
            keep_comments: false
          }).toString();
        }
        console.log(`Content = ${content.substring(0, 50)}...`);
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
  // async captureSnapshot(url) {
  //   const browser = await chromium.launch();
  //   let content = null;
  //   let retryCount = 0;
  //   const maxRetries = 3;
    
  //   while (retryCount < maxRetries) {
  //     const context = await browser.newContext();
  //     const page = await context.newPage();
  //     try {
  //       await page.goto(url, { waitUntil: 'networkidle0' });
    
  //       // Wait for initial page load
  //       await page.waitForTimeout(2000);
    
  //       // Enhanced React content detection with additional checks
  //       await page.evaluate(async () => {
  //         return new Promise((resolve) => {
  //           let hydrationComplete = false;
  //           let networkQuiet = false;
  //           let mutationsStopped = false;
            
  //           // Track React hydration completion with additional checks
  //           const checkHydration = () => {
  //             // Check for root element
  //             const root = document.getElementById('root');
  //             if (!root) return;
    
  //             // Check for React-specific properties
  //             const hasReactProps = Object.keys(root).some(key => 
  //               key.startsWith('__react') || key.startsWith('_reactRootContainer'));
              
  //             // Check for React DevTools
  //             const hasReactDevTools = window.__REACT_DEVTOOLS_GLOBAL_HOOK__ !== undefined;
              
  //             // Check for rendered content
  //             const hasContent = root.children.length > 0 || root.innerHTML.trim().length > 0;
              
  //             // Additional React state checks
  //             const hasReactState = !!window._reactRootContainer || 
  //                             !!document.querySelector('[data-reactroot]') ||
  //                             !!root._reactRootContainer ||
  //                             (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ && 
  //                              window.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers && 
  //                              window.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.size > 0);
              
  //             if (hasContent || hasReactProps || hasReactDevTools || hasReactState) {
  //               hydrationComplete = true;
  //               checkAllConditions();
  //             }
  //           };
    
  //           // Monitor network activity
  //           let pendingRequests = 0;
  //           const originalFetch = window.fetch;
  //           const originalXHR = window.XMLHttpRequest.prototype.send;
    
  //           window.fetch = async (...args) => {
  //             pendingRequests++;
  //             try {
  //               const response = await originalFetch.apply(window, args);
  //               return response;
  //             } finally {
  //               pendingRequests--;
  //               if (pendingRequests === 0) {
  //                 networkQuiet = true;
  //                 checkAllConditions();
  //               }
  //             }
  //           };
    
  //           window.XMLHttpRequest.prototype.send = function(...args) {
  //             pendingRequests++;
  //             this.addEventListener('loadend', () => {
  //               pendingRequests--;
  //               if (pendingRequests === 0) {
  //                 networkQuiet = true;
  //                 checkAllConditions();
  //               }
  //             });
  //             return originalXHR.apply(this, args);
  //           };
    
  //           // Monitor DOM mutations
  //           let mutationCount = 0;
  //           let lastMutationTime = Date.now();
  //           const observer = new MutationObserver((mutations) => {
  //             mutationCount += mutations.length;
  //             lastMutationTime = Date.now();
  //             checkHydration();
  //           });
    
  //           observer.observe(document.documentElement, {
  //             childList: true,
  //             subtree: true,
  //             attributes: true,
  //             characterData: true
  //           });
    
  //           // Check if mutations have stopped
  //           const checkMutations = () => {
  //             const timeSinceLastMutation = Date.now() - lastMutationTime;
  //             if (timeSinceLastMutation > 1000 && mutationCount > 0) {
  //               mutationsStopped = true;
  //               checkAllConditions();
  //             }
  //           };
    
  //           // Combined conditions check
  //           const checkAllConditions = () => {
  //             if ((hydrationComplete || mutationsStopped) && networkQuiet) {
  //               observer.disconnect();
  //               window.fetch = originalFetch;
  //               window.XMLHttpRequest.prototype.send = originalXHR;
  //               resolve();
  //             }
  //           };
    
  //           // Initial hydration check
  //           checkHydration();
    
  //           // Set up periodic checks
  //           const periodicCheck = setInterval(() => {
  //             checkHydration();
  //             checkMutations();
  //           }, 100);
    
  //           // Fallback timeout
  //           setTimeout(() => {
  //             clearInterval(periodicCheck);
  //             observer.disconnect();
  //             window.fetch = originalFetch;
  //             window.XMLHttpRequest.prototype.send = originalXHR;
  //             resolve();
  //           }, 30000);
  //         });
  //       });
    
  //       // Simulate human-like scrolling behavior
  //       await page.evaluate(() => {
  //         const scrollHeight = document.documentElement.scrollHeight;
  //         let currentScroll = 0;
  //         const scrollStep = Math.floor(Math.random() * 100) + 50;
          
  //         const smoothScroll = setInterval(() => {
  //           if (currentScroll >= scrollHeight) {
  //             clearInterval(smoothScroll);
  //             return;
  //           }
  //           window.scrollBy(0, scrollStep);
  //           currentScroll += scrollStep;
  //         }, 100);
  //       });
    
  //       const isChallenge = await page.evaluate(() => {
  //         return document.querySelector('div#cf-challenge-running') !== null;
  //       });
    
  //       if (isChallenge) {
  //         console.log(`Cloudflare challenge detected, attempt ${retryCount + 1}`);
  //         await page.waitForTimeout(15000 * Math.pow(2, retryCount));
  //         retryCount++;
  //       } else {
  //         content = await page.content();
  //         break;
  //       }
  //     } catch (error) {
  //       console.error(`Attempt ${retryCount + 1} failed: ${error.message}`);
  //       retryCount++;
  //     } finally {
  //       await page.close();
  //       await context.close();
  //     }
  //   }

  //   if (!content) {
  //     await browser.close();
  //     throw new Error('Failed to capture content after maximum retries');
  //   }

  //   await browser.close();
  //   const snapshot = {
  //     url,
  //     content,
  //     captured_at: new Date().toISOString()
  //   };

  //   const { data, error: snapshotError } = await supabase
  //     .from('dom_snapshots')
  //     .insert([snapshot])
  //     .select();

  //   if (snapshotError) throw snapshotError;

  //   // Update the source's last_snapshot_at
  //   const { error: sourceError } = await supabase
  //     .from('sources')
  //     .update({ last_snapshot_at: snapshot.captured_at })
  //     .eq('url', url);

  //   if (sourceError) throw sourceError;
  //   return data[0];
  // }