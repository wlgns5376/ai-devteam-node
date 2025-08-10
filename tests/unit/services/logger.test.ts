import fs from 'fs/promises';
import path from 'path';
import { Logger, LogLevel } from '@/services/logger';

describe('Logger', () => {
  const testLogDir = path.join(__dirname, '../../../test-logs');
  const testLogFile = path.join(testLogDir, 'test.log');
  let logger: Logger | null = null;

  // 현재 날짜를 YYYY-MM-DD 형식으로 가져오는 헬퍼 함수
  const getCurrentDateString = () => {
    const now = new Date();
    return now.toISOString().split('T')[0];
  };

  // 고유한 테스트 ID를 생성하여 테스트 간 격리 보장
  const getTestSpecificPath = (basePath: string, isDirectory: boolean = false) => {
    const testName = expect.getState().currentTestName || 'unknown';
    const timestamp = Date.now();
    const cleanTestName = testName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50); // 파일명 길이 제한
    const uniqueName = `${cleanTestName}-${timestamp}`;
    
    if (isDirectory) {
      // 디렉토리의 경우 testLogDir 내부에 생성
      return path.join(testLogDir, uniqueName);
    } else {
      // 파일의 경우 파일명에 고유 ID 추가
      const dir = path.dirname(basePath);
      const ext = path.extname(basePath);
      const name = path.basename(basePath, ext);
      return path.join(dir, `${name}-${uniqueName}${ext}`);
    }
  };

  beforeEach(async () => {
    // Given: 테스트용 로그 디렉토리 생성
    await fs.mkdir(testLogDir, { recursive: true });
    logger = null; // logger 인스턴스 초기화
  });

  afterEach(async () => {
    // Logger 리소스 정리
    if (logger) {
      await logger.flush(); // 대기 중인 모든 쓰기 작업 완료
      logger = null;
    }

    // 테스트 로그 파일 정리 - 재시도 로직 추가
    let retries = 3;
    while (retries > 0) {
      try {
        await fs.rm(testLogDir, { recursive: true, force: true });
        break;
      } catch (error) {
        retries--;
        if (retries === 0) {
          // console.warn 대신 조용히 실패 (테스트 출력 깔끔하게 유지)
          // 테스트 디렉토리는 다음 실행 시 재생성됨
        } else {
          // 잠시 대기 후 재시도
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }
  });

  describe('초기화', () => {
    it('should create logger with file and console output', () => {
      // Given: Logger 설정이 있을 때
      // When: Logger를 생성하면
      logger = new Logger({
        level: LogLevel.INFO,
        filePath: testLogFile,
        enableConsole: true
      });

      // Then: Logger가 생성되어야 함
      expect(logger).toBeDefined();
    });

    it('should create logger with console only', () => {
      // Given: 콘솔 출력만 설정되어 있을 때
      // When: Logger를 생성하면
      logger = new Logger({
        level: LogLevel.DEBUG,
        enableConsole: true
      });

      // Then: Logger가 생성되어야 함
      expect(logger).toBeDefined();
    });

    it('should create logger with file only', () => {
      // Given: 파일 출력만 설정되어 있을 때
      // When: Logger를 생성하면
      logger = new Logger({
        level: LogLevel.WARN,
        filePath: testLogFile,
        enableConsole: false
      });

      // Then: Logger가 생성되어야 함
      expect(logger).toBeDefined();
    });
  });

  describe('로그 레벨', () => {

    it('should log messages at or above configured level', async () => {
      // Given: WARN 레벨로 설정된 Logger가 있을 때
      const uniqueFile = getTestSpecificPath(testLogFile);
      logger = new Logger({
        level: LogLevel.WARN,
        filePath: uniqueFile,
        enableConsole: false
      });

      // When: 다양한 레벨의 메시지를 로깅하면
      logger.debug('Debug message');  // 로깅되지 않음
      logger.info('Info message');    // 로깅되지 않음
      logger.warn('Warning message'); // 로깅됨
      logger.error('Error message');  // 로깅됨

      // 파일 쓰기 완료 대기
      await logger.flush();

      // Then: WARN 이상의 메시지만 로깅되어야 함
      const logContent = await fs.readFile(uniqueFile, 'utf-8');
      expect(logContent).toContain('Warning message');
      expect(logContent).toContain('Error message');
      expect(logContent).not.toContain('Debug message');
      expect(logContent).not.toContain('Info message');
    });

    it('should log all messages with DEBUG level', async () => {
      // Given: DEBUG 레벨로 설정된 Logger가 있을 때
      const uniqueFile = getTestSpecificPath(testLogFile);
      logger = new Logger({
        level: LogLevel.DEBUG,
        filePath: uniqueFile,
        enableConsole: false
      });

      // When: 모든 레벨의 메시지를 로깅하면
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');

      // 파일 쓰기 완료 대기
      await logger.flush();

      // Then: 모든 메시지가 로깅되어야 함
      const logContent = await fs.readFile(uniqueFile, 'utf-8');
      expect(logContent).toContain('Debug message');
      expect(logContent).toContain('Info message');
      expect(logContent).toContain('Warning message');
      expect(logContent).toContain('Error message');
    });
  });

  describe('로그 포맷', () => {
    it('should format log messages correctly', async () => {
      // Given: Logger가 설정되어 있을 때
      const uniqueFile = getTestSpecificPath(testLogFile);
      logger = new Logger({
        level: LogLevel.INFO,
        filePath: uniqueFile,
        enableConsole: false
      });

      // When: 로그 메시지를 기록하면
      logger.info('Test message');

      // 파일 쓰기 완료 대기
      await logger.flush();

      // Then: 올바른 형식으로 로깅되어야 함
      const logContent = await fs.readFile(uniqueFile, 'utf-8');
      expect(logContent).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[INFO\] Test message/);
    });

    it('should include context information', async () => {
      // Given: Logger가 설정되어 있을 때
      const uniqueFile = getTestSpecificPath(testLogFile);
      logger = new Logger({
        level: LogLevel.INFO,
        filePath: uniqueFile,
        enableConsole: false
      });

      // When: 컨텍스트 정보와 함께 로그를 기록하면
      logger.info('Operation completed', { userId: 'user123', operation: 'task-update' });

      // 파일 쓰기 완료 대기
      await logger.flush();

      // Then: 컨텍스트 정보가 포함되어야 함
      const logContent = await fs.readFile(uniqueFile, 'utf-8');
      expect(logContent).toContain('Operation completed');
      expect(logContent).toContain('user123');
      expect(logContent).toContain('task-update');
    });

    it('should handle error objects properly', async () => {
      // Given: Logger가 설정되어 있을 때
      const uniqueFile = getTestSpecificPath(testLogFile);
      logger = new Logger({
        level: LogLevel.INFO,
        filePath: uniqueFile,
        enableConsole: false
      });

      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:1:1';

      // When: Error 객체를 로깅하면
      logger.error('Operation failed', { error });

      // 파일 쓰기 완료 대기
      await logger.flush();

      // Then: Error 정보가 포함되어야 함
      const logContent = await fs.readFile(uniqueFile, 'utf-8');
      expect(logContent).toContain('Operation failed');
      expect(logContent).toContain('Test error');
      expect(logContent).toContain('test.js:1:1');
    });
  });

  describe('파일 출력', () => {
    it('should create log directory if it does not exist', async () => {
      // Given: 존재하지 않는 디렉토리 경로가 있을 때
      const uniqueDir = getTestSpecificPath('nested-dir', true);
      const newLogDir = uniqueDir;
      const newLogFile = path.join(newLogDir, 'new.log');

      logger = new Logger({
        level: LogLevel.INFO,
        filePath: newLogFile,
        enableConsole: false
      });

      // When: 로그를 기록하면
      logger.info('Test message');

      // 파일 쓰기 완료 대기
      await logger.flush();

      // Then: 디렉토리가 생성되고 파일이 생성되어야 함
      const dirExists = await fs.access(newLogDir).then(() => true).catch(() => false);
      const fileExists = await fs.access(newLogFile).then(() => true).catch(() => false);
      
      expect(dirExists).toBe(true);
      expect(fileExists).toBe(true);
    });

    it('should append to existing log file', async () => {
      // Given: 기존 로그 파일이 있을 때
      const uniqueFile = getTestSpecificPath(testLogFile);
      await fs.writeFile(uniqueFile, 'Existing log content\n');

      logger = new Logger({
        level: LogLevel.INFO,
        filePath: uniqueFile,
        enableConsole: false
      });

      // When: 새로운 로그를 기록하면
      logger.info('New log message');

      // 파일 쓰기 완료 대기
      await logger.flush();

      // Then: 기존 내용에 추가되어야 함
      const logContent = await fs.readFile(uniqueFile, 'utf-8');
      expect(logContent).toContain('Existing log content');
      expect(logContent).toContain('New log message');
    });
  });

  describe('콘솔 출력', () => {
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('should output to console when enabled', () => {
      // Given: 콘솔 출력이 활성화된 Logger가 있을 때
      logger = new Logger({
        level: LogLevel.INFO,
        enableConsole: true
      });

      // When: 로그 메시지를 기록하면
      logger.info('Console message');

      // Then: 콘솔에 출력되어야 함
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] Console message')
      );
    });

    it('should not output to console when disabled', () => {
      // Given: 콘솔 출력이 비활성화된 Logger가 있을 때
      logger = new Logger({
        level: LogLevel.INFO,
        filePath: testLogFile,
        enableConsole: false
      });

      // When: 로그 메시지를 기록하면
      logger.info('No console message');

      // Then: 콘솔에 출력되지 않아야 함
      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });

  describe('일자별 로그 파일', () => {
    it('should create daily log files with date pattern', async () => {
      // Given: 로그 디렉토리만 지정하고 Logger를 생성할 때
      const uniqueLogDir = getTestSpecificPath('daily-logs', true);
      await fs.mkdir(uniqueLogDir, { recursive: true });
      
      logger = new Logger({
        level: LogLevel.INFO,
        logDirectory: uniqueLogDir,
        enableConsole: false
      });

      // When: 로그를 기록하면
      logger.info('Daily log test');

      // 파일 쓰기 완료 대기
      await logger.flush();

      // Then: 현재 날짜로 된 로그 파일이 생성되어야 함
      const currentDate = getCurrentDateString();
      const expectedLogFile = path.join(uniqueLogDir, `${currentDate}.log`);
      
      const fileExists = await fs.access(expectedLogFile).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);

      const logContent = await fs.readFile(expectedLogFile, 'utf-8');
      expect(logContent).toContain('Daily log test');
    });

    it('should append to existing daily log file', async () => {
      // Given: 이미 오늘 날짜의 로그 파일이 있을 때
      const uniqueLogDir = getTestSpecificPath('daily-logs', true);
      await fs.mkdir(uniqueLogDir, { recursive: true });
      
      const currentDate = getCurrentDateString();
      const dailyLogFile = path.join(uniqueLogDir, `${currentDate}.log`);
      await fs.writeFile(dailyLogFile, 'Existing daily log\n');

      logger = new Logger({
        level: LogLevel.INFO,
        logDirectory: uniqueLogDir,
        enableConsole: false
      });

      // When: 새로운 로그를 기록하면
      logger.info('New daily log entry');

      // 파일 쓰기 완료 대기
      await logger.flush();

      // Then: 기존 내용에 추가되어야 함
      const logContent = await fs.readFile(dailyLogFile, 'utf-8');
      expect(logContent).toContain('Existing daily log');
      expect(logContent).toContain('New daily log entry');
    });

    it('should support both logDirectory and filePath for backward compatibility', async () => {
      // Given: 기존 filePath 방식으로 Logger를 생성할 때
      const uniqueFile = getTestSpecificPath(testLogFile);
      
      logger = new Logger({
        level: LogLevel.INFO,
        filePath: uniqueFile,
        enableConsole: false
      });

      // When: 로그를 기록하면
      logger.info('Backward compatibility test');

      // 파일 쓰기 완료 대기
      await logger.flush();

      // Then: 기존 방식대로 파일이 생성되어야 함
      const fileExists = await fs.access(uniqueFile).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);

      const logContent = await fs.readFile(uniqueFile, 'utf-8');
      expect(logContent).toContain('Backward compatibility test');
    });
  });

  describe('정적 팩토리 메서드', () => {
    it('should create daily logger with createDailyLogger', async () => {
      // Given: createDailyLogger로 Logger를 생성할 때
      const uniqueLogDir = getTestSpecificPath('daily-logs', true);
      await fs.mkdir(uniqueLogDir, { recursive: true });
      
      logger = Logger.createDailyLogger(uniqueLogDir, LogLevel.INFO);

      // When: 로그를 기록하면
      logger.info('Factory method test');

      // 파일 쓰기 완료 대기
      await logger.flush();

      // Then: 일자별 로그 파일이 생성되어야 함
      const currentDate = getCurrentDateString();
      const expectedLogFile = path.join(uniqueLogDir, `${currentDate}.log`);
      
      const fileExists = await fs.access(expectedLogFile).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
    });

    it('should create daily combined logger with createDailyCombinedLogger', async () => {
      // Given: createDailyCombinedLogger로 Logger를 생성할 때
      const uniqueLogDir = getTestSpecificPath('daily-logs', true);
      await fs.mkdir(uniqueLogDir, { recursive: true });
      
      // When: createDailyCombinedLogger로 Logger를 생성하면
      logger = Logger.createDailyCombinedLogger(uniqueLogDir, LogLevel.DEBUG);

      // Then: Logger가 올바르게 생성되어야 함
      expect(logger).toBeDefined();
      
      // 실제 로그 작성 테스트
      logger.debug('Combined logger test');
      await logger.flush();
      
      const currentDate = getCurrentDateString();
      const expectedLogFile = path.join(uniqueLogDir, `${currentDate}.log`);
      const fileExists = await fs.access(expectedLogFile).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
    });
  });

  describe('에러 처리', () => {
    it('should handle file write errors gracefully', async () => {
      // Given: 쓰기 권한이 없는 파일 경로로 Logger를 생성할 때
      const readOnlyFile = '/root/readonly.log';
      logger = new Logger({
        level: LogLevel.INFO,
        filePath: readOnlyFile,
        enableConsole: false
      });

      // When & Then: 로그 기록이 오류 없이 처리되어야 함
      expect(() => {
        logger!.info('This should not crash');
      }).not.toThrow();

      // 대기 중인 쓰기 작업 완료 (에러는 무시됨)
      await logger!.flush();
    });

    it('should handle circular references in context', async () => {
      // Given: 순환 참조가 있는 객체가 있을 때
      const circularObj: any = { name: 'test' };
      circularObj.self = circularObj;

      const uniqueFile = getTestSpecificPath(testLogFile);
      logger = new Logger({
        level: LogLevel.INFO,
        filePath: uniqueFile,
        enableConsole: false
      });

      // When & Then: 순환 참조 객체를 로깅해도 오류가 발생하지 않아야 함
      expect(() => {
        logger!.info('Circular reference test', { data: circularObj });
      }).not.toThrow();

      // 파일 쓰기 완료 대기
      await logger!.flush();

      // Then: 로그 파일에 에러 메시지가 포함되어야 함
      const logContent = await fs.readFile(uniqueFile, 'utf-8');
      expect(logContent).toContain('Circular reference test');
      expect(logContent).toContain('Context serialization failed');
    });

    it('should handle empty log messages', async () => {
      // Given: Logger가 설정되어 있을 때
      const uniqueFile = getTestSpecificPath(testLogFile);
      logger = new Logger({
        level: LogLevel.INFO,
        filePath: uniqueFile,
        enableConsole: false
      });

      // When & Then: 빈 메시지를 로깅해도 오류가 발생하지 않아야 함
      expect(() => {
        logger!.info('');
        logger!.info('   '); // 공백만 있는 메시지
      }).not.toThrow();

      await logger!.flush();
    });
  });
});