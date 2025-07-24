import { ServiceFactory } from '@/services/service-factory';
import { MockProjectBoardService } from '@/services/mock-project-board';
import { MockPullRequestService } from '@/services/mock-pull-request';
import { ProjectBoardService, PullRequestService, ServiceProvider } from '@/types';

describe('ServiceFactory', () => {
  let factory: ServiceFactory;

  beforeEach(() => {
    factory = new ServiceFactory();
  });

  describe('초기화', () => {
    it('should create ServiceFactory successfully', () => {
      // Given: ServiceFactory 생성자가 있을 때
      // When: ServiceFactory를 생성하면
      const serviceFactory = new ServiceFactory();

      // Then: ServiceFactory가 생성되어야 함
      expect(serviceFactory).toBeDefined();
      expect(serviceFactory).toBeInstanceOf(ServiceFactory);
    });
  });

  describe('createProjectBoardService', () => {
    it('should create MockProjectBoardService for mock provider', () => {
      // Given: ServiceFactory가 있을 때
      // When: mock 프로바이더로 ProjectBoardService를 생성하면
      const service = factory.createProjectBoardService(ServiceProvider.MOCK);

      // Then: MockProjectBoardService 인스턴스가 반환되어야 함
      expect(service).toBeDefined();
      expect(service).toBeInstanceOf(MockProjectBoardService);
    });

    it('should implement ProjectBoardService interface', () => {
      // Given: ServiceFactory가 있을 때
      // When: ProjectBoardService를 생성하면
      const service = factory.createProjectBoardService(ServiceProvider.MOCK);

      // Then: ProjectBoardService 인터페이스를 구현해야 함
      const boardService: ProjectBoardService = service;
      expect(boardService).toBeDefined();
      expect(typeof boardService.getBoard).toBe('function');
      expect(typeof boardService.getItems).toBe('function');
      expect(typeof boardService.updateItemStatus).toBe('function');
      expect(typeof boardService.addPullRequestToItem).toBe('function');
    });

    it('should throw error for unsupported provider', () => {
      // Given: ServiceFactory가 있을 때
      // When: 지원하지 않는 프로바이더로 서비스를 생성하려고 하면
      // Then: 에러가 발생해야 함
      expect(() => factory.createProjectBoardService(ServiceProvider.GITHUB))
        .toThrow('Unsupported project board provider: github');
    });
  });

  describe('createPullRequestService', () => {
    it('should create MockPullRequestService for mock provider', () => {
      // Given: ServiceFactory가 있을 때
      // When: mock 프로바이더로 PullRequestService를 생성하면
      const service = factory.createPullRequestService(ServiceProvider.MOCK);

      // Then: MockPullRequestService 인스턴스가 반환되어야 함
      expect(service).toBeDefined();
      expect(service).toBeInstanceOf(MockPullRequestService);
    });

    it('should implement PullRequestService interface', () => {
      // Given: ServiceFactory가 있을 때
      // When: PullRequestService를 생성하면
      const service = factory.createPullRequestService(ServiceProvider.MOCK);

      // Then: PullRequestService 인터페이스를 구현해야 함
      const prService: PullRequestService = service;
      expect(prService).toBeDefined();
      expect(typeof prService.getPullRequest).toBe('function');
      expect(typeof prService.listPullRequests).toBe('function');
      expect(typeof prService.createPullRequest).toBe('function');
      expect(typeof prService.updatePullRequestStatus).toBe('function');
      expect(typeof prService.addComment).toBe('function');
      expect(typeof prService.getComments).toBe('function');
    });

    it('should throw error for unsupported provider', () => {
      // Given: ServiceFactory가 있을 때
      // When: 지원하지 않는 프로바이더로 서비스를 생성하려고 하면
      // Then: 에러가 발생해야 함
      expect(() => factory.createPullRequestService(ServiceProvider.GITHUB))
        .toThrow('Unsupported pull request provider: github');
    });
  });

  describe('createServices', () => {
    it('should create all services with same provider', () => {
      // Given: ServiceFactory가 있을 때
      // When: 모든 서비스를 한 번에 생성하면
      const services = factory.createServices(ServiceProvider.MOCK);

      // Then: 모든 서비스가 생성되어야 함
      expect(services).toBeDefined();
      expect(services.projectBoardService).toBeDefined();
      expect(services.pullRequestService).toBeDefined();
      expect(services.projectBoardService).toBeInstanceOf(MockProjectBoardService);
      expect(services.pullRequestService).toBeInstanceOf(MockPullRequestService);
    });

    it('should return services that implement correct interfaces', () => {
      // Given: ServiceFactory가 있을 때
      // When: 모든 서비스를 생성하면
      const services = factory.createServices(ServiceProvider.MOCK);

      // Then: 올바른 인터페이스를 구현해야 함
      const { projectBoardService, pullRequestService } = services;
      
      // ProjectBoardService 인터페이스 확인
      expect(typeof projectBoardService.getBoard).toBe('function');
      expect(typeof projectBoardService.getItems).toBe('function');
      expect(typeof projectBoardService.updateItemStatus).toBe('function');
      expect(typeof projectBoardService.addPullRequestToItem).toBe('function');

      // PullRequestService 인터페이스 확인
      expect(typeof pullRequestService.getPullRequest).toBe('function');
      expect(typeof pullRequestService.listPullRequests).toBe('function');
      expect(typeof pullRequestService.createPullRequest).toBe('function');
      expect(typeof pullRequestService.updatePullRequestStatus).toBe('function');
      expect(typeof pullRequestService.addComment).toBe('function');
      expect(typeof pullRequestService.getComments).toBe('function');
    });

    it('should throw error for unsupported provider', () => {
      // Given: ServiceFactory가 있을 때
      // When: 지원하지 않는 프로바이더로 서비스들을 생성하려고 하면
      // Then: 에러가 발생해야 함
      expect(() => factory.createServices(ServiceProvider.GITHUB))
        .toThrow();
    });
  });

  describe('싱글톤 인스턴스', () => {
    it('should return same instance for same provider', () => {
      // Given: ServiceFactory가 있을 때
      // When: 같은 프로바이더로 서비스를 여러 번 생성하면
      const service1 = factory.createProjectBoardService(ServiceProvider.MOCK);
      const service2 = factory.createProjectBoardService(ServiceProvider.MOCK);

      // Then: 같은 인스턴스가 반환되어야 함 (싱글톤)
      expect(service1).toBe(service2);
    });

    it('should return same PR service instance for same provider', () => {
      // Given: ServiceFactory가 있을 때
      // When: 같은 프로바이더로 PullRequestService를 여러 번 생성하면
      const service1 = factory.createPullRequestService(ServiceProvider.MOCK);
      const service2 = factory.createPullRequestService(ServiceProvider.MOCK);

      // Then: 같은 인스턴스가 반환되어야 함 (싱글톤)
      expect(service1).toBe(service2);
    });

    it('should return same services bundle for same provider', () => {
      // Given: ServiceFactory가 있을 때
      // When: 같은 프로바이더로 서비스 번들을 여러 번 생성하면
      const services1 = factory.createServices(ServiceProvider.MOCK);
      const services2 = factory.createServices(ServiceProvider.MOCK);

      // Then: 같은 서비스 인스턴스들이 반환되어야 함
      expect(services1.projectBoardService).toBe(services2.projectBoardService);
      expect(services1.pullRequestService).toBe(services2.pullRequestService);
    });
  });

  describe('에러 처리', () => {
    it('should provide meaningful error messages', () => {
      // Given: ServiceFactory가 있을 때
      // When: 잘못된 프로바이더를 사용하면
      // Then: 명확한 에러 메시지가 제공되어야 함
      expect(() => factory.createProjectBoardService('invalid' as any))
        .toThrow('Unsupported project board provider: invalid');
        
      expect(() => factory.createPullRequestService('invalid' as any))
        .toThrow('Unsupported pull request provider: invalid');
    });
  });
});