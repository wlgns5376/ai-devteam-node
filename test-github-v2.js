require('dotenv').config();

const { GitHubProjectBoardV2Service } = require('./dist/services/project-board/github/github-project-board-v2.service.js');
const { Logger } = require('./dist/services/logger.js');

async function test() {
  const config = {
    owner: 'wlgns5376',
    projectNumber: 3,
    token: process.env.GITHUB_TOKEN,
    repositoryFilter: {
      allowedRepositories: ['wlgns5376/ai-devteam-test'],
      mode: 'whitelist'
    }
  };
  
  try {
    console.log('Creating GitHub Projects v2 service...');
    const logger = Logger.createConsoleLogger();
    const service = new GitHubProjectBoardV2Service(config, logger);
    
    console.log('Getting items from GitHub Projects v2...');
    const items = await service.getItems();
    
    console.log(`\nFound ${items.length} items:\n`);
    items.forEach((item, index) => {
      console.log(`${index + 1}. ${item.title}`);
      console.log(`   Status: ${item.status}`);
      console.log(`   Repository: ${item.repository || 'No repository'}`);
      console.log(`   ID: ${item.id}`);
      console.log('');
    });
  } catch (error) {
    console.error('Error:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
  }
}

test();