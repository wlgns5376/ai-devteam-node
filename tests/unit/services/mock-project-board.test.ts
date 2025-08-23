import { MockProjectBoardService } from '@/services/project-board/mock/mock-project-board';
import { ProjectBoard, ProjectBoardItem, ProjectBoardService } from '@/types';

describe('MockProjectBoardService', () => {
  let service: MockProjectBoardService;

  beforeEach(() => {
    service = new MockProjectBoardService();
  });

  describe('getBoard', () => {
    it('should return project board with mock data', async () => {
      // Given: MockProjectBoardService가 있을 때
      // When: 보드를 조회하면
      const result = await service.getBoard('board-1');

      // Then: 모킹된 프로젝트 보드가 반환되어야 함
      expect(result).toBeDefined();
      expect(result.id).toBe('board-1');
      expect(result.name).toBe('AI DevTeam Project');
      expect(result.description).toBe('Mock project board for AI DevTeam automation system');
    });

    it('should return different board data for different board IDs', async () => {
      // Given: MockProjectBoardService가 있을 때
      // When: 다른 보드 ID로 조회하면
      const board1 = await service.getBoard('board-1');
      const board2 = await service.getBoard('board-2');

      // Then: 다른 보드 정보가 반환되어야 함
      expect(board1.id).toBe('board-1');
      expect(board2.id).toBe('board-2');
      expect(board1.name).not.toBe(board2.name);
    });
  });

  describe('getItems', () => {
    it('should return all items when no status filter is provided', async () => {
      // Given: MockProjectBoardService가 있을 때
      // When: 상태 필터 없이 아이템을 조회하면
      const items = await service.getItems('board-1');

      // Then: 모든 상태의 아이템이 반환되어야 함
      expect(items).toBeDefined();
      expect(items.length).toBeGreaterThan(0);
      expect(items).toContainEqual(expect.objectContaining({ status: 'TODO' }));
      expect(items).toContainEqual(expect.objectContaining({ status: 'IN_PROGRESS' }));
      expect(items).toContainEqual(expect.objectContaining({ status: 'DONE' }));
    });

    it('should return filtered items when status is provided', async () => {
      // Given: MockProjectBoardService가 있을 때
      // When: 특정 상태로 필터링하여 조회하면
      const todoItems = await service.getItems('board-1', 'TODO');

      // Then: 해당 상태의 아이템만 반환되어야 함
      expect(todoItems).toBeDefined();
      expect(todoItems.length).toBeGreaterThan(0);
      todoItems.forEach(item => {
        expect(item.status).toBe('TODO');
      });
    });

    it('should return empty array for unknown status', async () => {
      // Given: MockProjectBoardService가 있을 때
      // When: 존재하지 않는 상태로 조회하면
      const items = await service.getItems('board-1', 'UNKNOWN_STATUS');

      // Then: 빈 배열이 반환되어야 함
      expect(items).toBeDefined();
      expect(items).toHaveLength(0);
    });

    it('should return items with correct structure', async () => {
      // Given: MockProjectBoardService가 있을 때
      // When: 아이템을 조회하면
      const items = await service.getItems('board-1');

      // Then: 올바른 구조의 아이템이 반환되어야 함
      expect(items.length).toBeGreaterThan(0);
      const item = items[0];
      expect(item).toBeDefined();
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('title');
      expect(item).toHaveProperty('description');
      expect(item).toHaveProperty('status');
      expect(item).toHaveProperty('assignee');
      expect(item).toHaveProperty('labels');
      expect(item).toHaveProperty('createdAt');
      expect(item).toHaveProperty('updatedAt');
      expect(item).toHaveProperty('pullRequestUrls');
      expect(Array.isArray(item!.labels)).toBe(true);
      expect(Array.isArray(item!.pullRequestUrls)).toBe(true);
    });
  });

  describe('updateItemStatus', () => {
    it('should update item status successfully', async () => {
      // Given: MockProjectBoardService와 기존 아이템이 있을 때
      const items = await service.getItems('board-1');
      const targetItem = items.find(item => item.status === 'TODO');
      expect(targetItem).toBeDefined();

      // When: 아이템의 상태를 업데이트하면
      const updatedItem = await service.updateItemStatus(targetItem!.id, 'IN_PROGRESS');

      // Then: 업데이트된 아이템이 반환되어야 함
      expect(updatedItem).toBeDefined();
      expect(updatedItem.id).toBe(targetItem!.id);
      expect(updatedItem.status).toBe('IN_PROGRESS');
      expect(updatedItem.updatedAt).toBeInstanceOf(Date);
      expect(updatedItem.updatedAt.getTime()).toBeGreaterThan(targetItem!.updatedAt.getTime());
    });

    it('should throw error for non-existent item', async () => {
      // Given: MockProjectBoardService가 있을 때
      // When: 존재하지 않는 아이템을 업데이트하려고 하면
      // Then: 에러가 발생해야 함
      await expect(service.updateItemStatus('non-existent-id', 'DONE'))
        .rejects.toThrow('Item not found: non-existent-id');
    });

    it('should persist status changes across getItems calls', async () => {
      // Given: MockProjectBoardService와 아이템이 있을 때
      const items = await service.getItems('board-1');
      const targetItem = items.find(item => item.status === 'TODO');
      expect(targetItem).toBeDefined();

      // When: 아이템 상태를 업데이트하고
      await service.updateItemStatus(targetItem!.id, 'DONE');

      // Then: 이후 조회에서도 업데이트된 상태가 유지되어야 함
      const updatedItems = await service.getItems('board-1');
      const updatedItem = updatedItems.find(item => item.id === targetItem!.id);
      expect(updatedItem).toBeDefined();
      expect(updatedItem!.status).toBe('DONE');
    });
  });

  describe('addPullRequestToItem', () => {
    it('should add pull request URL to item successfully', async () => {
      // Given: MockProjectBoardService와 기존 아이템이 있을 때
      const items = await service.getItems('board-1');
      const targetItem = items[0];
      expect(targetItem).toBeDefined();
      const initialPrCount = targetItem!.pullRequestUrls.length;
      const newPrUrl = 'https://github.com/example/repo/pull/123';

      // When: PR URL을 추가하면
      await service.addPullRequestToItem(targetItem!.id, newPrUrl);

      // Then: PR URL이 추가되어야 함
      const updatedItems = await service.getItems('board-1');
      const updatedItem = updatedItems.find(item => item.id === targetItem!.id);
      expect(updatedItem).toBeDefined();
      expect(updatedItem!.pullRequestUrls).toHaveLength(initialPrCount + 1);
      expect(updatedItem!.pullRequestUrls).toContain(newPrUrl);
    });

    it('should not add duplicate pull request URLs', async () => {
      // Given: MockProjectBoardService와 기존 아이템이 있을 때
      const items = await service.getItems('board-1');
      const targetItem = items[0];
      expect(targetItem).toBeDefined();
      const duplicatePrUrl = 'https://github.com/example/repo/pull/999';

      // When: 같은 PR URL을 두 번 추가하면
      await service.addPullRequestToItem(targetItem!.id, duplicatePrUrl);
      await service.addPullRequestToItem(targetItem!.id, duplicatePrUrl);

      // Then: PR URL이 한 번만 추가되어야 함
      const updatedItems = await service.getItems('board-1');
      const updatedItem = updatedItems.find(item => item.id === targetItem!.id);
      expect(updatedItem).toBeDefined();
      const duplicateCount = updatedItem!.pullRequestUrls.filter(url => url === duplicatePrUrl).length;
      expect(duplicateCount).toBe(1);
    });

    it('should throw error for non-existent item', async () => {
      // Given: MockProjectBoardService가 있을 때
      // When: 존재하지 않는 아이템에 PR URL을 추가하려고 하면
      // Then: 에러가 발생해야 함
      await expect(service.addPullRequestToItem('non-existent-id', 'https://github.com/example/repo/pull/123'))
        .rejects.toThrow('Item not found: non-existent-id');
    });
  });

  describe('interface compliance', () => {
    it('should implement ProjectBoardService interface', () => {
      // Given: MockProjectBoardService가 있을 때
      // When: ProjectBoardService 타입으로 할당하면
      const boardService: ProjectBoardService = service;

      // Then: 타입 에러가 발생하지 않아야 함
      expect(boardService).toBeDefined();
      expect(typeof boardService.getBoard).toBe('function');
      expect(typeof boardService.getItems).toBe('function');
      expect(typeof boardService.updateItemStatus).toBe('function');
      expect(typeof boardService.addPullRequestToItem).toBe('function');
    });
  });
});