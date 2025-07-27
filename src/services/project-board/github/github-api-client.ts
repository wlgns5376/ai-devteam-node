import { Octokit } from '@octokit/rest';
import { GitHubApiError } from './types';

/**
 * GitHub API Client wrapper with direct API calls
 * Octokit v22ではProjects Classic APIが削除されているため、直接APIを呼び出す
 */
export class GitHubApiClient {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({
      auth: token,
      userAgent: 'ai-devteam-node',
      timeZone: 'UTC',
      baseUrl: 'https://api.github.com'
    });
  }

  /**
   * List repository projects
   */
  async listProjects(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'open') {
    try {
      const response = await this.octokit.request('GET /repos/{owner}/{repo}/projects', {
        owner,
        repo,
        state,
        headers: {
          'Accept': 'application/vnd.github.inertia-preview+json'
        }
      });
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to list projects');
    }
  }

  /**
   * Get a project
   */
  async getProject(projectId: number) {
    try {
      const response = await this.octokit.request('GET /projects/{project_id}', {
        project_id: projectId,
        headers: {
          'Accept': 'application/vnd.github.inertia-preview+json'
        }
      });
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get project');
    }
  }

  /**
   * List project columns
   */
  async listColumns(projectId: number) {
    try {
      const response = await this.octokit.request('GET /projects/{project_id}/columns', {
        project_id: projectId,
        headers: {
          'Accept': 'application/vnd.github.inertia-preview+json'
        }
      });
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to list columns');
    }
  }

  /**
   * List cards in a column
   */
  async listCards(columnId: number, archivedState: 'all' | 'archived' | 'not_archived' = 'not_archived') {
    try {
      const response = await this.octokit.request('GET /projects/columns/{column_id}/cards', {
        column_id: columnId,
        archived_state: archivedState,
        headers: {
          'Accept': 'application/vnd.github.inertia-preview+json'
        }
      });
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to list cards');
    }
  }

  /**
   * Get a project card
   */
  async getCard(cardId: number) {
    try {
      const response = await this.octokit.request('GET /projects/columns/cards/{card_id}', {
        card_id: cardId,
        headers: {
          'Accept': 'application/vnd.github.inertia-preview+json'
        }
      });
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get card');
    }
  }

  /**
   * Update a project card
   */
  async updateCard(cardId: number, note?: string, archived?: boolean) {
    try {
      const requestBody: any = {
        card_id: cardId,
        headers: {
          'Accept': 'application/vnd.github.inertia-preview+json'
        }
      };

      if (note !== undefined) {
        requestBody.note = note;
      }

      if (archived !== undefined) {
        requestBody.archived = archived;
      }

      const response = await this.octokit.request('PATCH /projects/columns/cards/{card_id}', requestBody);
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to update card');
    }
  }

  /**
   * Move a project card
   */
  async moveCard(cardId: number, columnId: number, position: 'top' | 'bottom' | string = 'top') {
    try {
      const response = await this.octokit.request('POST /projects/columns/cards/{card_id}/moves', {
        card_id: cardId,
        column_id: columnId,
        position,
        headers: {
          'Accept': 'application/vnd.github.inertia-preview+json'
        }
      });
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to move card');
    }
  }

  private handleError(error: any, message: string): GitHubApiError {
    if (error.status) {
      return new GitHubApiError(
        `${message}: ${error.message}`,
        error.status,
        error
      );
    }
    return new GitHubApiError(message, 0, error);
  }
}