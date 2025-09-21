#!/usr/bin/env node

import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

// Environment variables validation
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GITHUB_TOKEN'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingVars.join(', '));
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GitHub API configuration
const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

/**
 * Fetch GitHub repository contributors
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Promise<Array>} Array of contributors
 */
async function fetchGitHubContributors(owner, repo) {
  try {
    const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/contributors`, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'fix-contributor-table'
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const contributors = await response.json();
    console.log(`✅ Fetched ${contributors.length} contributors from ${owner}/${repo}`);
    return contributors;
  } catch (error) {
    console.error('❌ Error fetching GitHub contributors:', error.message);
    throw error;
  }
}

/**
 * Store contributors data in Supabase
 * @param {Array} contributors - Array of contributor objects
 * @param {string} repoName - Repository name for reference
 * @returns {Promise<void>}
 */
async function storeContributorsInSupabase(contributors, repoName) {
  try {
    // Prepare data for insertion
    const contributorData = contributors.map(contributor => ({
      username: contributor.login,
      github_id: contributor.id,
      avatar_url: contributor.avatar_url,
      html_url: contributor.html_url,
      contributions: contributor.contributions,
      repository: repoName,
      type: contributor.type,
      updated_at: new Date().toISOString()
    }));

    // Insert data into Supabase (assuming a 'contributors' table exists)
    const { data, error } = await supabase
      .from('contributors')
      .upsert(contributorData, { 
        onConflict: 'github_id,repository',
        ignoreDuplicates: false 
      });

    if (error) {
      throw new Error(`Supabase error: ${error.message}`);
    }

    console.log(`✅ Stored ${contributorData.length} contributors in Supabase`);
    return data;
  } catch (error) {
    console.error('❌ Error storing contributors in Supabase:', error.message);
    throw error;
  }
}

/**
 * Main function to fix contributor table
 */
async function fixContributorTable() {
  console.log('🚀 Starting fix-contributor process...');
  
  try {
    // Example repository - this would typically be passed as arguments or env vars
    const owner = process.env.REPO_OWNER || 'babblebey';
    const repo = process.env.REPO_NAME || 'fix-contributor-table';
    
    console.log(`📊 Processing repository: ${owner}/${repo}`);
    
    // Step 1: Fetch contributors from GitHub
    const contributors = await fetchGitHubContributors(owner, repo);
    
    // Step 2: Store contributors in Supabase
    await storeContributorsInSupabase(contributors, `${owner}/${repo}`);
    
    console.log('✨ Fix contributor process completed successfully!');
    
  } catch (error) {
    console.error('💥 Fix contributor process failed:', error.message);
    process.exit(1);
  }
}

/**
 * Additional utility function to test Supabase connection
 */
async function testSupabaseConnection() {
  try {
    const { data, error } = await supabase
      .from('contributors')
      .select('count', { count: 'exact', head: true });
    
    if (error) {
      console.error('❌ Supabase connection test failed:', error.message);
      return false;
    }
    
    console.log('✅ Supabase connection successful');
    return true;
  } catch (error) {
    console.error('❌ Supabase connection test error:', error.message);
    return false;
  }
}

// Run the main function if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  // Test connections first
  console.log('🔍 Testing connections...');
  
  Promise.all([
    testSupabaseConnection()
  ]).then(([supabaseOk]) => {
    if (supabaseOk) {
      return fixContributorTable();
    } else {
      console.error('❌ Connection tests failed');
      process.exit(1);
    }
  }).catch(error => {
    console.error('💥 Script execution failed:', error.message);
    process.exit(1);
  });
}

// Export functions for potential reuse
export {
  fetchGitHubContributors,
  storeContributorsInSupabase,
  testSupabaseConnection,
  fixContributorTable
};