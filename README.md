# daily-snapshot
## Archiving a daily snapshot of chosen sources

A lightweight service that captures daily content snapshots of specified web pages, stores them in Supabase, and runs automatically via GitHub Actions. Built with Node.js, Playwright, JSDOM and the Supabase JavaScript client. This project is designed to be cost-efficient, and easy to maintain.

Currently using Mozilla's Readability for parsing and content filtering, aiming to get the best precision for 99% of sources.

## Features

- Daily Snapshots: Automatically captures content from a list of active sources every day at midnight UTC.
- Supabase Storage: Saves snapshots in a Supabase database for easy retrieval and analysis.
- Stealth Browsing: Uses Playwright with stealth plugins to evade bot detection.
- GitHub Actions: Runs as a scheduled job with no need for external servers.

## How It Works

- Sources: A list of URLs is stored in a Supabase table (sources) with an is_active flag.
- Snapshot Job: Every day at 00:00 UTC, a GitHub Actions workflow runs snapshot-job.js.
- Capture: Playwright fetches each active source, processes it with Readability, and stores the result in Supabase (dom_snapshots).
- Manual Trigger: Use the GitHub Actions UI to run the job on-demand.

## Prerequisites
- Node.js: Version 18 or higher.
- Supabase Account: A project with tables sources and dom_snapshots (see Database Schema).
- GitHub Repository: A public repo with Actions enabled.

## Setup

### Install Dependencies
```
npm install
```

### Configure Supabase

Get your `SUPABASE_URL` and `SUPABASE_ANON_KEY` from the project settings.

Set up the database (see Database Schema below).

Add these as GitHub Secrets:
- Go to your repo’s Settings > Secrets and variables > Actions > Secrets.
- Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` as new secrets.

### Customize Sources

Add URLs to the sources table in Supabase with is_active: true to start snapshotting them.

### Database Schema
The project uses two Supabase tables:

`sources`

| Column | Type | Description | 
|--------|------|-------------|
| id     | int8     | Auto-incrementing ID (PK)          |
| url    | text     | URL to snapshot (unique)            |
| is_active    | boolean     | Whether to include in runs            |
| last_snapshot_at    | timestampz     |             |

`dom_snapshots`

| Column | Type | Description | 
|--------|------|-------------|
| id     | int8     | Auto-incrementing ID (PK)          |
| url    | text     | Source URL (FK to sources)            |
| content    | text     | Parsed and filtered content            |
| captured_at    | timestampz     | Time of snapshot            |

Create these tables in Supabase via the SQL editor or dashboard.

## Local Development

To test locally:

Set environment variables:
```
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_ANON_KEY="your-anon-key"
```

Run the script:

```
node snapshot-job.js
```

## Contributing
Contributions are welcome! Feel free to:
- Open issues for bugs or feature requests.
- Submit pull requests with improvements.

## License
This project is licensed under the MIT License.