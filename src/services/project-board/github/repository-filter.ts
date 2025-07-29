/**
 * GitHub Projects v2 레포지토리 필터링 유틸리티
 */

import { ProjectV2Item, ProjectV2ItemContent, RepositoryInfo, RepositoryFilterConfig } from './graphql-types';

export class RepositoryFilter {
  /**
   * 프로젝트 아이템 목록을 레포지토리 필터에 따라 필터링
   */
  static filterItems(
    items: ProjectV2Item[], 
    filter?: RepositoryFilterConfig
  ): ProjectV2Item[] {
    if (!filter || !filter.allowedRepositories || filter.allowedRepositories.length === 0) {
      return items;
    }

    return items.filter(item => {
      const repoString = this.extractRepositoryFromItem(item);
      if (!repoString) {
        // Draft issue나 레포지토리 정보가 없는 아이템은 필터링 기준에 따라 처리
        return filter.mode === 'blacklist'; // blacklist 모드에서는 포함, whitelist 모드에서는 제외
      }

      return this.isRepositoryAllowed(repoString, filter);
    });
  }

  /**
   * 프로젝트 아이템에서 레포지토리 정보 추출
   */
  static extractRepositoryFromItem(item: ProjectV2Item): string | null {
    if (!item.content) {
      return null;
    }

    const content = item.content;
    if (content.__typename === 'Issue' || content.__typename === 'PullRequest') {
      const repo = content.repository;
      if (repo) {
        return `${repo.owner.login}/${repo.name}`;
      }
    }

    return null;
  }

  /**
   * 레포지토리 정보를 객체로 추출
   */
  static extractRepositoryInfoFromItem(item: ProjectV2Item): RepositoryInfo | null {
    const repoString = this.extractRepositoryFromItem(item);
    if (!repoString) {
      return null;
    }

    return this.parseRepositoryString(repoString);
  }

  /**
   * 레포지토리 문자열을 파싱하여 owner/repo 분리
   */
  static parseRepositoryString(repoString: string): RepositoryInfo | null {
    const parts = repoString.split('/');
    if (parts.length !== 2) {
      return null;
    }

    return {
      owner: parts[0] || '',
      name: parts[1] || ''
    };
  }

  /**
   * 레포지토리가 필터 설정에 따라 허용되는지 확인
   */
  static isRepositoryAllowed(
    repoString: string, 
    filter: RepositoryFilterConfig
  ): boolean {
    const allowedRepos = filter.allowedRepositories || [];
    const isInList = allowedRepos.includes(repoString);

    switch (filter.mode) {
      case 'whitelist':
        return isInList;
      case 'blacklist':
        return !isInList;
      default:
        return true;
    }
  }

  /**
   * 레포지토리 목록에서 패턴 매칭 지원
   * 예: "org/star", "star/specific-repo", "star" 등
   */
  static isRepositoryAllowedWithPatterns(
    repoString: string,
    filter: RepositoryFilterConfig
  ): boolean {
    const allowedRepos = filter.allowedRepositories || [];
    
    const matchesPattern = allowedRepos.some(pattern => {
      if (pattern === '*') {
        return true; // 모든 레포지토리 허용
      }

      if (pattern.includes('*')) {
        const regex = new RegExp(
          '^' + pattern.replace(/\*/g, '.*') + '$'
        );
        return regex.test(repoString);
      }

      return pattern === repoString;
    });

    switch (filter.mode) {
      case 'whitelist':
        return matchesPattern;
      case 'blacklist':
        return !matchesPattern;
      default:
        return true;
    }
  }

  /**
   * 필터 설정 검증
   */
  static validateFilter(filter: RepositoryFilterConfig): string[] {
    const errors: string[] = [];

    if (!filter.mode) {
      errors.push('Filter mode is required');
    } else if (!['whitelist', 'blacklist'].includes(filter.mode)) {
      errors.push('Filter mode must be either "whitelist" or "blacklist"');
    }

    if (filter.allowedRepositories) {
      if (!Array.isArray(filter.allowedRepositories)) {
        errors.push('allowedRepositories must be an array');
      } else {
        filter.allowedRepositories.forEach((repo, index) => {
          if (typeof repo !== 'string') {
            errors.push(`Repository at index ${index} must be a string`);
          } else if (repo.trim() === '') {
            errors.push(`Repository at index ${index} cannot be empty`);
          } else if (!repo.includes('/') && repo !== '*' && !repo.includes('*')) {
            errors.push(`Repository at index ${index} must be in format "owner/repo" or contain wildcards`);
          }
        });
      }
    }

    return errors;
  }

  /**
   * 레포지토리 목록을 그룹화 (owner별로)
   */
  static groupRepositoriesByOwner(items: ProjectV2Item[]): Map<string, Set<string>> {
    const grouped = new Map<string, Set<string>>();

    items.forEach(item => {
      const repoInfo = this.extractRepositoryInfoFromItem(item);
      if (repoInfo) {
        if (!grouped.has(repoInfo.owner)) {
          grouped.set(repoInfo.owner, new Set());
        }
        grouped.get(repoInfo.owner)!.add(repoInfo.name);
      }
    });

    return grouped;
  }

  /**
   * 필터링 통계 정보 생성
   */
  static getFilteringStats(
    originalItems: ProjectV2Item[],
    filteredItems: ProjectV2Item[],
    filter?: RepositoryFilterConfig
  ): {
    total: number;
    filtered: number;
    excluded: number;
    repositories: string[];
    excludedRepositories: string[];
  } {
    const allRepos = new Set<string>();
    const filteredRepos = new Set<string>();

    originalItems.forEach(item => {
      const repo = this.extractRepositoryFromItem(item);
      if (repo) {
        allRepos.add(repo);
      }
    });

    filteredItems.forEach(item => {
      const repo = this.extractRepositoryFromItem(item);
      if (repo) {
        filteredRepos.add(repo);
      }
    });

    const excludedRepos = [...allRepos].filter(repo => !filteredRepos.has(repo));

    return {
      total: originalItems.length,
      filtered: filteredItems.length,
      excluded: originalItems.length - filteredItems.length,
      repositories: [...filteredRepos].sort(),
      excludedRepositories: excludedRepos.sort()
    };
  }
}