require('dotenv').config();

const { GitHubPullRequestService } = require('./dist/services/pull-request/github/github-pull-request.service.js');
const { Logger } = require('./dist/services/logger.js');

async function test() {
  const config = {
    token: process.env.GITHUB_TOKEN
  };
  
  try {
    console.log('Creating GitHub PullRequest service...');
    const logger = Logger.createConsoleLogger();
    const service = new GitHubPullRequestService(config, logger);
    
    const repoId = 'wlgns5376/ai-devteam-test';
    
    console.log('\n=== Testing PR List ===');
    const prs = await service.listPullRequests(repoId);
    console.log(`Found ${prs.length} pull requests:\n`);
    
    for (const pr of prs.slice(0, 3)) { // 처음 3개만 표시
      console.log(`PR #${pr.id}: ${pr.title}`);
      console.log(`  Status: ${pr.status}`);
      console.log(`  Author: ${pr.author}`);
      console.log(`  Approved: ${pr.isApproved ? 'Yes' : 'No'}`);
      console.log(`  Review State: ${pr.reviewState}`);
      console.log(`  URL: ${pr.url}`);
      console.log('');
      
      // 첫 번째 PR에 대해 더 자세한 정보 확인
      if (pr === prs[0] && prs.length > 0) {
        console.log('=== Testing detailed PR info ===');
        
        // 승인 상태 확인
        const isApproved = await service.isApproved(repoId, pr.id);
        console.log(`Approval status: ${isApproved}`);
        
        // 리뷰 목록
        const reviews = await service.getReviews(repoId, pr.id);
        console.log(`Reviews count: ${reviews.length}`);
        reviews.forEach(review => {
          console.log(`  - ${review.reviewer}: ${review.state} (${review.submittedAt.toISOString()})`);
        });
        
        // 코멘트 목록
        const comments = await service.getComments(repoId, pr.id);
        console.log(`Comments count: ${comments.length}`);
        comments.slice(0, 2).forEach(comment => {
          console.log(`  - ${comment.author}: ${comment.content.substring(0, 50)}...`);
        });
        
        // 최근 24시간 내 새 코멘트
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const newComments = await service.getNewComments(repoId, pr.id, yesterday);
        console.log(`New comments (last 24h): ${newComments.length}`);
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
  }
}

test();