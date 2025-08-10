/**
 * RepositoryInfoExtractor - 저장소 정보 추출 유틸리티 클래스
 * boardItem과 PR URL에서 저장소 ID를 추출하는 로직을 분리
 */

export class RepositoryInfoExtractor {
  /**
   * boardItem과 PR URL에서 저장소 정보를 추출
   */
  static extractRepositoryFromBoardItem(boardItem: any, pullRequestUrl?: string, fallbackRepoId?: string): string {
    // 1. PR URL이 있으면 우선적으로 사용
    if (pullRequestUrl) {
      const repoFromPrUrl = this.extractRepositoryFromUrl(pullRequestUrl);
      if (repoFromPrUrl) {
        return repoFromPrUrl;
      }
    }
    
    // 2. boardItem에서 repository 정보 추출
    const repoFromBoardItem = this.extractRepositoryFromBoardItemData(boardItem);
    if (repoFromBoardItem) {
      return repoFromBoardItem;
    }
    
    // 3. boardItem의 pullRequestUrls에서 추출 시도
    if (boardItem?.pullRequestUrls && boardItem.pullRequestUrls.length > 0) {
      const repoFromUrls = this.extractRepositoryFromUrls(boardItem.pullRequestUrls);
      if (repoFromUrls) {
        return repoFromUrls;
      }
    }
    
    // 4. 기본값 사용
    return fallbackRepoId || 'unknown/repository';
  }

  /**
   * PR URL에서 저장소 정보 추출
   */
  private static extractRepositoryFromUrl(pullRequestUrl: string): string | null {
    try {
      const match = pullRequestUrl.match(/github\.com\/([^\/]+\/[^\/]+)\/pull\/\d+/);
      if (match && match[1]) {
        return match[1];
      }
    } catch (error) {
      // URL 파싱 실패 시 무시
    }
    return null;
  }

  /**
   * boardItem 데이터에서 저장소 정보 추출
   */
  private static extractRepositoryFromBoardItemData(boardItem: any): string | null {
    // metadata.repository에서 추출
    if (boardItem?.metadata?.repository) {
      return boardItem.metadata.repository;
    }
    
    // repository.id에서 추출
    if (boardItem?.repository?.id) {
      return boardItem.repository.id;
    }
    
    // content.repository.nameWithOwner에서 추출
    if (boardItem?.content?.repository?.nameWithOwner) {
      return boardItem.content.repository.nameWithOwner;
    }
    
    return null;
  }

  /**
   * PR URL 배열에서 저장소 정보 추출
   */
  private static extractRepositoryFromUrls(pullRequestUrls: string[]): string | null {
    for (const prUrl of pullRequestUrls) {
      const repo = this.extractRepositoryFromUrl(prUrl);
      if (repo) {
        return repo;
      }
    }
    return null;
  }

  /**
   * 저장소 ID 유효성 검사
   */
  static isValidRepositoryId(repositoryId: string): boolean {
    if (!repositoryId || repositoryId === 'unknown/repository') {
      return false;
    }
    
    // owner/repo 형식인지 확인
    const parts = repositoryId.split('/');
    if (parts.length !== 2) {
      return false;
    }
    
    const owner = parts[0];
    const repo = parts[1];
    
    return typeof owner === 'string' && owner.length > 0 &&
           typeof repo === 'string' && repo.length > 0;
  }

  /**
   * 저장소 ID 정규화
   */
  static normalizeRepositoryId(repositoryId: string): string {
    if (!repositoryId) {
      return 'unknown/repository';
    }
    
    // 이미 정규화된 형식인지 확인
    if (this.isValidRepositoryId(repositoryId)) {
      return repositoryId;
    }
    
    // GitHub URL에서 추출 시도
    const extracted = this.extractRepositoryFromUrl(repositoryId);
    if (extracted) {
      return extracted;
    }
    
    return 'unknown/repository';
  }

  /**
   * GitHub URL 생성
   */
  static generateGitHubUrl(repositoryId: string, path?: string): string {
    const normalizedRepo = this.normalizeRepositoryId(repositoryId);
    
    if (!this.isValidRepositoryId(normalizedRepo)) {
      throw new Error(`Invalid repository ID: ${repositoryId}`);
    }
    
    const baseUrl = `https://github.com/${normalizedRepo}`;
    return path ? `${baseUrl}/${path}` : baseUrl;
  }

  /**
   * 저장소 소유자 추출
   */
  static extractOwner(repositoryId: string): string {
    const normalized = this.normalizeRepositoryId(repositoryId);
    if (this.isValidRepositoryId(normalized)) {
      const parts = normalized.split('/');
      return parts[0] || 'unknown';
    }
    return 'unknown';
  }

  /**
   * 저장소 이름 추출
   */
  static extractRepoName(repositoryId: string): string {
    const normalized = this.normalizeRepositoryId(repositoryId);
    if (this.isValidRepositoryId(normalized)) {
      const parts = normalized.split('/');
      return parts[1] || 'unknown';
    }
    return 'unknown';
  }
}