export interface Repository {
  readonly id: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly url: string;
  readonly defaultBranch: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface Commit {
  readonly sha: string;
  readonly message: string;
  readonly author: string;
  readonly date: Date;
}

export interface Branch {
  readonly name: string;
  readonly commitSha: string;
  readonly isDefault: boolean;
  readonly lastCommit: Commit;
}

export interface FileContent {
  readonly path: string;
  readonly content: string;
  readonly encoding: string;
  readonly size: number;
  readonly sha: string;
}

export interface FileUpdate {
  readonly path: string;
  readonly sha: string;
}

export interface RepositoryService {
  getRepository(repoId: string): Promise<Repository>;
  listBranches(repoId: string): Promise<ReadonlyArray<Branch>>;
  getBranch(repoId: string, branchName: string): Promise<Branch>;
  createBranch(repoId: string, branchName: string, sourceBranch: string): Promise<Branch>;
  getFileContent(repoId: string, filePath: string, branch: string): Promise<FileContent>;
  updateFile(repoId: string, filePath: string, branch: string, content: string, message: string, author: string): Promise<FileUpdate>;
  createFile(repoId: string, filePath: string, branch: string, content: string, message: string, author: string): Promise<FileUpdate>;
}