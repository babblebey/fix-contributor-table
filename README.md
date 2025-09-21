# fix-contributor-table

A JavaScript tool to fix and maintain contributor tables by syncing GitHub repository contributors with Supabase database.

## Features

- Fetches contributor data from GitHub API
- Stores contributor information in Supabase database
- Supports manual GitHub Actions workflow dispatch
- Environment variable validation
- Error handling and logging

## Prerequisites

- Node.js 18+ 
- npm or yarn
- Supabase project with a `contributors` table
- GitHub personal access token

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd fix-contributor-table
```

2. Install dependencies:
```bash
npm install
```

## Environment Variables

The following environment variables are required:

- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key (with database access)
- `GITHUB_TOKEN`: GitHub personal access token with repo access

Optional environment variables:
- `REPO_OWNER`: GitHub repository owner (defaults to current repository owner)
- `REPO_NAME`: GitHub repository name (defaults to current repository name)

## Usage

### Local Development

1. Set up your environment variables:
```bash
export SUPABASE_URL="your-supabase-url"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
export GITHUB_TOKEN="your-github-token"
```

2. Run the script:
```bash
npm run fix-contributor
# or
npm start
```

### GitHub Actions

The repository includes a GitHub Actions workflow that can be manually triggered:

1. Go to the "Actions" tab in your GitHub repository
2. Select "Fix Contributor Table" workflow
3. Click "Run workflow"
4. Optionally specify:
   - Repository owner (defaults to current repo owner)
   - Repository name (defaults to current repo name)
   - Dry run mode (test without making changes)

### Required Secrets

Configure the following secrets in your GitHub repository settings:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GITHUB_TOKEN` (automatically available in GitHub Actions)

## Database Schema

The script expects a `contributors` table in Supabase with the following structure:

```sql
CREATE TABLE contributors (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  github_id BIGINT NOT NULL,
  avatar_url TEXT,
  html_url TEXT,
  contributions INTEGER DEFAULT 0,
  repository TEXT NOT NULL,
  type TEXT DEFAULT 'User',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(github_id, repository)
);
```

## Project Structure

```
fix-contributor-table/
├── .github/
│   └── workflows/
│       └── fix-contributor.yml    # GitHub Actions workflow
├── fix-contributor.js             # Main script
├── package.json                   # Project configuration
├── .gitignore                     # Git ignore rules
└── README.md                      # This file
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

ISC