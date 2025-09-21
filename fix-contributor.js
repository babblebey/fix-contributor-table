/**
 * Fix Missing Author IDs Script
 * 
 * This script fixes missing author_id fields in pull_requests and issues tables
 * by fetching author data from GitHub API and creating/linking contributors.
 * 
 * Usage:
 *   node scripts/data-sync/fix-missing-author-ids.js
 * 
 * Environment Variables Required:
 *   - SUPABASE_URL or VITE_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - GITHUB_TOKEN or VITE_GITHUB_TOKEN
 * 
 * Configuration (optional):
 *   - BATCH_SIZE (default: 50)
 *   - DELAY_BETWEEN_REQUESTS (default: 300ms)
 *   - DELAY_BETWEEN_BATCHES (default: 2000ms)
 *   - USE_REPLICA_TABLES (default: true for safety)
 */

import { createClient } from '@supabase/supabase-js'
import fetch from 'node-fetch'

// Configuration from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.VITE_GITHUB_TOKEN
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 50
const DELAY_BETWEEN_REQUESTS = parseInt(process.env.DELAY_BETWEEN_REQUESTS) || 300
const DELAY_BETWEEN_BATCHES = parseInt(process.env.DELAY_BETWEEN_BATCHES) || 2000
const USE_REPLICA_TABLES = false // Default to true

// Debug environment variables
console.log('🔧 Environment Check:')
console.log(`   SUPABASE_URL: ${SUPABASE_URL ? '✅ Set' : '❌ Missing'}`)
console.log(`   SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY ? '✅ Set' : '❌ Missing'}`)
console.log(`   GITHUB_TOKEN: ${GITHUB_TOKEN ? '✅ Set' : '❌ Missing'}`)

// Validate required environment variables
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GITHUB_TOKEN) {
  console.error('\n❌ Missing required environment variables:')
  if (!SUPABASE_URL) console.error('  - SUPABASE_URL or VITE_SUPABASE_URL')
  if (!SUPABASE_SERVICE_ROLE_KEY) console.error('  - SUPABASE_SERVICE_ROLE_KEY')
  if (!GITHUB_TOKEN) console.error('  - GITHUB_TOKEN or VITE_GITHUB_TOKEN')
  console.error('\nPlease set these variables in your environment or .env file')
  process.exit(1)
}

console.log('✅ All environment variables found')

// Initialize Supabase client
console.log('🔗 Initializing Supabase client...')
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
console.log('✅ Supabase client created')

// GitHub API headers
console.log('📡 Setting up GitHub API headers...')
const githubHeaders = {
  'Authorization': `token ${GITHUB_TOKEN}`,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'contributor-info-author-fixer'
}
console.log('✅ GitHub API headers configured')

console.log('📋 Defining AuthorIdFixer class...')

class AuthorIdFixer {
  constructor() {
    console.log('🏗️  Initializing AuthorIdFixer...')
    
    this.processedCount = 0
    this.errorCount = 0
    this.createdContributors = 0
    this.updatedRows = 0
    this.skippedRows = 0
    this.apiCallCount = 0
    
    // Table names based on whether we're using replicas
    this.tables = USE_REPLICA_TABLES ? {
      issues: 'issues_replica',
      pullRequests: 'pull_requests_replica',
      contributors: 'contributors_replica',
      repositories: 'repositories' // Always use main repositories table
    } : {
      issues: 'issues',
      pullRequests: 'pull_requests',
      contributors: 'contributors',
      repositories: 'repositories'
    }
    
    console.log(`🔧 Configuration:`)
    console.log(`   Using replica tables: ${USE_REPLICA_TABLES}`)
    console.log(`   Batch size: ${BATCH_SIZE}`)
    console.log(`   Request delay: ${DELAY_BETWEEN_REQUESTS}ms`)
    console.log(`   Batch delay: ${DELAY_BETWEEN_BATCHES}ms`)
    console.log(`   Tables:`, this.tables)
    
    console.log('✅ AuthorIdFixer initialized successfully')
  }

  // Utility function for delays
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // Get repository info from repositories table
  async getRepositoryInfo(repositoryId) {
    const { data: repo, error } = await supabase
      .from(this.tables.repositories)
      .select('owner, name, github_id')
      .eq('id', repositoryId)
      .single()
    
    if (error) {
      throw new Error(`Repository not found: ${repositoryId} - ${error.message}`)
    }
    
    return repo
  }

  // Check GitHub API rate limits
  async checkRateLimit() {
    try {
      const response = await fetch('https://api.github.com/rate_limit', { headers: githubHeaders })
      const rateLimit = await response.json()
      
      const remaining = rateLimit.rate.remaining
      const resetTime = new Date(rateLimit.rate.reset * 1000)
      
      console.log(`📊 GitHub API Rate Limit: ${remaining}/5000 remaining (resets at ${resetTime.toLocaleTimeString()})`)
      
      if (remaining < 100) {
        console.log(`⚠️  Low rate limit remaining. Consider waiting until ${resetTime.toLocaleTimeString()}`)
      }
      
      return { remaining, resetTime }
    } catch (error) {
      console.log('⚠️  Could not check rate limit:', error.message)
      return { remaining: 5000, resetTime: new Date() }
    }
  }

  // Fetch author from GitHub API
  async fetchAuthorFromGithub(repositoryId, issueNumber, retryCount = 0) {
    try {
      const repo = await this.getRepositoryInfo(repositoryId)
      
      // GitHub Issues API endpoint (works for both issues and pull requests)
      const endpoint = `https://api.github.com/repos/${repo.owner}/${repo.name}/issues/${issueNumber}`
      
      console.log(`  📡 Fetching: ${repo.owner}/${repo.name}#${issueNumber}`)
      
      const response = await fetch(endpoint, { headers: githubHeaders })
      this.apiCallCount++
      
      if (response.status === 404) {
        console.log(`  ⚠️  Not found: ${repo.owner}/${repo.name}#${issueNumber}`)
        return null
      }
      
      if (response.status === 403) {
        const resetTime = response.headers.get('x-ratelimit-reset')
        const resetDate = resetTime ? new Date(parseInt(resetTime) * 1000) : new Date(Date.now() + 60000)
        
        console.log(`  ⏱️  Rate limited. Reset at: ${resetDate.toLocaleTimeString()}`)
        
        if (retryCount < 3) {
          const waitTime = Math.min((resetDate - new Date()) + 5000, 300000) // Max 5 minutes wait
          console.log(`  ⏳ Waiting ${Math.round(waitTime/1000)}s before retry...`)
          await this.delay(waitTime)
          return this.fetchAuthorFromGithub(repositoryId, issueNumber, retryCount + 1)
        }
        
        throw new Error('Rate limit exceeded after retries')
      }

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
      }
      
      const issueData = await response.json()
      
      if (!issueData.user) {
        console.log(`  ⚠️  No user data for ${repo.owner}/${repo.name}#${issueNumber}`)
        return null
      }
      
      console.log(`  ✅ Found author: ${issueData.user.login} (${issueData.user.id})`)
      return issueData.user
      
    } catch (error) {
      console.error(`  ❌ Error fetching ${issueNumber}: ${error.message}`)
      if (retryCount < 2) {
        await this.delay(2000)
        return this.fetchAuthorFromGithub(repositoryId, issueNumber, retryCount + 1)
      }
      throw error
    }
  }

  // Find existing contributor or create new one
  async findOrCreateContributor(githubUser) {
    try {
      // Check if contributor already exists by github_id
      const { data: existingContributor, error: findError } = await supabase
        .from(this.tables.contributors)
        .select('id')
        .eq('github_id', githubUser.id)
        .maybeSingle()

      if (findError) {
        console.error(`  ❌ Error searching for contributor:`, findError)
        throw findError
      }

      if (existingContributor) {
        console.log(`  🔗 Found existing contributor: ${existingContributor.id}`)
        return existingContributor.id
      }

      // Create new contributor record
      const contributorData = {
        github_id: githubUser.id,
        username: githubUser.login,
        display_name: githubUser.name || githubUser.login,
        email: githubUser.email,
        avatar_url: githubUser.avatar_url,
        profile_url: githubUser.html_url,
        company: githubUser.company,
        location: githubUser.location,
        bio: githubUser.bio,
        blog: githubUser.blog,
        public_repos: githubUser.public_repos || 0,
        public_gists: githubUser.public_gists || 0,
        followers: githubUser.followers || 0,
        following: githubUser.following || 0,
        github_created_at: githubUser.created_at,
        first_seen_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
        is_bot: githubUser.type === 'Bot',
        is_active: true,
        created_at: new Date().toISOString()
      }

      const { data: newContributor, error: createError } = await supabase
        .from(this.tables.contributors)
        .insert([contributorData])
        .select('id')
        .single()

      if (createError) {
        console.error(`  ❌ Error creating contributor:`, createError)
        throw createError
      }

      this.createdContributors++
      console.log(`  ➕ Created contributor: ${githubUser.login} -> ${newContributor.id}`)
      return newContributor.id

    } catch (error) {
      console.error(`  ❌ Contributor error for ${githubUser?.login}:`, error.message)
      throw error
    }
  }

  // Update author_id in the target table
  async updateAuthorId(tableName, rowId, authorId) {
    try {
      console.log(`    🔄 Updating ${tableName} ${rowId} with author_id: ${authorId}`)
      
      const { data, error } = await supabase
        .from(tableName)
        .update({ author_id: authorId })
        .eq('id', rowId)
        .select('id, author_id')

      if (error) {
        console.error(`  ❌ Update error:`, error)
        throw error
      }

      if (data && data.length > 0) {
        console.log(`    ✅ Successfully updated: ${data[0].id} -> ${data[0].author_id}`)
        this.updatedRows++
      } else {
        console.log(`    ⚠️  Update returned no data - possibly blocked by RLS`)
        throw new Error('Update returned no data - check RLS policies')
      }
    } catch (error) {
      console.error(`  ❌ Update failed:`, error.message)
      throw error
    }
  }

  // Fetch rows with missing author_id
  async fetchRowsWithMissingAuthors(tableName, offset = 0, limit = BATCH_SIZE) {
    console.log(`📥 Fetching ${limit} rows from ${tableName} (offset: ${offset})`)
    
    const { data, error } = await supabase
      .from(tableName)
      .select('id, github_id, number, repository_id, author_id, created_at')
      .is('author_id', null)
      .not('repository_id', 'is', null)
      .not('number', 'is', null)
      .range(offset, offset + limit - 1)
      .order('created_at', { ascending: true })

    if (error) {
      console.error(`❌ Error fetching rows:`, error)
      throw error
    }

    console.log(`📥 Retrieved ${data?.length || 0} rows`)
    return data || []
  }

  // Process a batch of rows
  async processBatch(tableName, rows) {
    console.log(`\n🔄 Processing batch of ${rows.length} rows from ${tableName}`)
    
    for (const [index, row] of rows.entries()) {
      try {
        console.log(`\n[${index + 1}/${rows.length}] Processing ${tableName} #${row.number} (${row.id})`)
        console.log(`  Created: ${new Date(row.created_at).toLocaleDateString()}`)
        
        // Fetch author from GitHub API
        const githubUser = await this.fetchAuthorFromGithub(row.repository_id, row.number)
        
        if (githubUser) {
          // Find or create contributor
          const contributorId = await this.findOrCreateContributor(githubUser)
          
          if (contributorId) {
            // Update the row with author_id
            await this.updateAuthorId(tableName, row.id, contributorId)
            console.log(`  ✅ Updated ${tableName} #${row.number}: ${githubUser.login} -> ${contributorId}`)
          }
        } else {
          console.log(`  ⚠️  No author found, skipping ${tableName} #${row.number}`)
          this.skippedRows++
        }

        this.processedCount++
        
        // Rate limiting delay between requests
        await this.delay(DELAY_BETWEEN_REQUESTS)

      } catch (error) {
        console.error(`\n❌ Error processing ${tableName} #${row.number}:`, error.message)
        this.errorCount++
        
        // Continue processing other rows
      }
    }
  }

  // Get total count of rows needing fixes
  async getRowCount(tableName) {
    try {
      const { count, error } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true })
        .is('author_id', null)
        .not('repository_id', 'is', null)
        .not('number', 'is', null)

      if (error) {
        console.error(`❌ Error counting rows in ${tableName}:`, error)
        throw error
      }

      return count || 0
    } catch (error) {
      console.error(`❌ Network error counting rows in ${tableName}:`, error.message)
      // Return 0 to continue processing instead of crashing
      return 0
    }
  }

  // Process all rows for a given table
  async processTable(tableName) {
    console.log(`\n🚀 === Processing ${tableName} table ===`)
    
    const totalRows = await this.getRowCount(tableName)
    console.log(`📊 Total rows to process: ${totalRows}`)

    if (totalRows === 0) {
      console.log(`✅ No rows to process in ${tableName}`)
      return
    }

    let offset = 0
    let processedBatches = 0

    while (true) {
      const rows = await this.fetchRowsWithMissingAuthors(tableName, offset, BATCH_SIZE)
      
      if (rows.length === 0) {
        console.log(`✅ No more rows to process in ${tableName}`)
        break
      }

      await this.processBatch(tableName, rows)
      
      processedBatches++
      offset += BATCH_SIZE
      
      console.log(`\n📈 Batch ${processedBatches} completed for ${tableName}`)
      console.log(`   Progress: ${Math.min(offset, totalRows)}/${totalRows} rows`)
      this.printStats()
      
      // Check rate limits periodically
      if (processedBatches % 5 === 0) {
        await this.checkRateLimit()
      }
      
      // Delay between batches to be gentle on APIs
      if (rows.length === BATCH_SIZE) {
        console.log(`⏳ Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`)
        await this.delay(DELAY_BETWEEN_BATCHES)
      }
    }

    console.log(`✅ Finished processing ${tableName}`)
  }

  // Print current statistics
  printStats() {
    console.log(`\n📊 Current Statistics:`)
    console.log(`   Rows processed: ${this.processedCount}`)
    console.log(`   Rows updated: ${this.updatedRows}`)
    console.log(`   Rows skipped: ${this.skippedRows}`)
    console.log(`   New contributors: ${this.createdContributors}`)
    console.log(`   API calls made: ${this.apiCallCount}`)
    console.log(`   Errors: ${this.errorCount}`)
  }

  // Main execution function
  async run() {
    try {
      console.log('🚀 Starting Author ID Fix Process...')
      console.log(`📅 Started at: ${new Date().toLocaleString()}`)

      // Initial rate limit check
      console.log('🔍 Checking GitHub API rate limit...')
      await this.checkRateLimit()

    const startTime = Date.now()

      console.log('📋 Processing tables...')
      
      // // Process issues table first (typically smaller)
      // console.log('🔄 Starting issues table processing...')
      // await this.processTable(this.tables.issues)
      
      // Process pull_requests table  
      console.log('🔄 Starting pull_requests table processing...')
      await this.processTable(this.tables.pullRequests)

      const endTime = Date.now()
      const duration = Math.round((endTime - startTime) / 1000)

      console.log('\n🎉 === Process Completed Successfully! ===')
      console.log(`📅 Completed at: ${new Date().toLocaleString()}`)
      console.log(`⏱️  Total time: ${duration} seconds`)
      console.log(`⚡ Average speed: ${Math.round(this.processedCount / (duration / 60))} rows/minute`)
      this.printStats()

      // Final recommendations
      if (USE_REPLICA_TABLES && this.updatedRows > 0) {
        console.log(`\n💡 Next Steps:`)
        console.log(`   1. Review the results in replica tables`)
        console.log(`   2. Run validation: node scripts/data-sync/validate-author-fix.js`)
        console.log(`   3. If satisfied, run with USE_REPLICA_TABLES=false to update production`)
      }

    } catch (error) {
      console.error('\n💥 Fatal error in run():')
      console.error('Error message:', error.message)
      console.error('Error stack:', error.stack)
      this.printStats()
      throw error // Re-throw to be caught by the outer handler
    }
  }
}

console.log('✅ AuthorIdFixer class defined')

// Run the script if called directly
console.log('🔍 Checking if script is run directly...')
console.log('import.meta.url:', import.meta.url)
console.log('process.argv[1]:', process.argv[1])

// Fix for Windows path handling
import { fileURLToPath } from 'url'
const __filename = fileURLToPath(import.meta.url)
const isMainModule = process.argv[1] === __filename

console.log('__filename:', __filename)
console.log('isMainModule:', isMainModule)

if (isMainModule) {
  console.log('✅ Script is run directly, starting execution...')
  console.log('🔧 Author ID Fixer - Contributor.info Database Maintenance')
  console.log('=' .repeat(60))
  
  console.log('🏗️ Creating AuthorIdFixer instance...')
  const fixer = new AuthorIdFixer()
  
  console.log('🚀 Starting run() method...')
  fixer.run().catch((error) => {
    console.error('💥 FATAL ERROR:')
    console.error(error)
    console.error('\nStack trace:')
    console.error(error.stack)
    process.exit(1)
  })
} else {
  console.log('ℹ️ Script imported as module, not running directly')
}

export default AuthorIdFixer