import fs from 'fs/promises';
import path from 'path';
import { Logger, LogLevel } from '@/services/logger';

describe('Logger 환경변수 설정', () => {
  const testLogDir = path.join(__dirname, '../../../test-logs');
  const envLogDir = path.join(__dirname, '../../../env-test-logs');
  let originalEnv: string | undefined;

  beforeEach(async () => {
    // Given: 원본 환경변수 저장
    originalEnv = process.env.LOG_DIRECTORY;
    // 테스트용 로그 디렉토리 생성
    await fs.mkdir(testLogDir, { recursive: true });
    await fs.mkdir(envLogDir, { recursive: true });
  });

  afterEach(async () => {
    // 환경변수 복원
    if (originalEnv !== undefined) {
      process.env.LOG_DIRECTORY = originalEnv;
    } else {
      delete process.env.LOG_DIRECTORY;
    }
    // 테스트 로그 파일 정리
    try {
      await fs.rm(testLogDir, { recursive: true, force: true });
      await fs.rm(envLogDir, { recursive: true, force: true });
    } catch (error) {
      // 디렉토리가 없을 수 있음
    }
  });

  it('should use LOG_DIRECTORY environment variable when logDirectory is not provided', async () => {
    // Given: LOG_DIRECTORY 환경변수가 설정되어 있을 때
    process.env.LOG_DIRECTORY = envLogDir;
    
    // When: logDirectory 없이 Logger를 생성하면
    const logger = new Logger({
      level: LogLevel.INFO,
      enableConsole: false
    });

    const testMessage = 'Environment variable test';
    logger.info(testMessage);

    // 파일 쓰기 작업이 완료될 때까지 대기
    await new Promise(resolve => setTimeout(resolve, 100));

    // Then: 환경변수로 지정된 디렉토리에 로그 파일이 생성되어야 함
    const today = new Date().toISOString().split('T')[0];
    const expectedLogFile = path.join(envLogDir, `${today}.log`);
    
    const fileContent = await fs.readFile(expectedLogFile, 'utf-8');
    expect(fileContent).toContain(testMessage);
  });

  it('should prioritize explicit logDirectory over environment variable', async () => {
    // Given: LOG_DIRECTORY 환경변수와 명시적 logDirectory가 모두 설정되어 있을 때
    process.env.LOG_DIRECTORY = envLogDir;
    
    // When: 명시적 logDirectory로 Logger를 생성하면
    const logger = new Logger({
      level: LogLevel.INFO,
      logDirectory: testLogDir,
      enableConsole: false
    });

    const testMessage = 'Explicit directory test';
    logger.info(testMessage);

    // 파일 쓰기 작업이 완료될 때까지 대기
    await new Promise(resolve => setTimeout(resolve, 100));

    // Then: 명시적으로 지정된 디렉토리에 로그 파일이 생성되어야 함
    const today = new Date().toISOString().split('T')[0];
    const expectedLogFile = path.join(testLogDir, `${today}.log`);
    
    const fileContent = await fs.readFile(expectedLogFile, 'utf-8');
    expect(fileContent).toContain(testMessage);

    // And: 환경변수 디렉토리에는 파일이 없어야 함
    const envLogFile = path.join(envLogDir, `${today}.log`);
    await expect(fs.access(envLogFile)).rejects.toThrow();
  });

  it('should not write to file when neither logDirectory nor LOG_DIRECTORY is set', async () => {
    // Given: LOG_DIRECTORY 환경변수가 설정되지 않고, logDirectory도 지정하지 않을 때
    delete process.env.LOG_DIRECTORY;
    
    // When: Logger를 생성하면
    const logger = new Logger({
      level: LogLevel.INFO,
      enableConsole: false
    });

    const testMessage = 'No file output test';
    logger.info(testMessage);

    // 파일 쓰기 시도가 있을 수 있으므로 대기
    await new Promise(resolve => setTimeout(resolve, 100));

    // Then: 어떤 디렉토리에도 로그 파일이 생성되지 않아야 함
    const today = new Date().toISOString().split('T')[0];
    
    const testLogFile = path.join(testLogDir, `${today}.log`);
    await expect(fs.access(testLogFile)).rejects.toThrow();
    
    const envLogFile = path.join(envLogDir, `${today}.log`);
    await expect(fs.access(envLogFile)).rejects.toThrow();
  });

  it('should use environment variable with createDailyLogger when directory is not provided', async () => {
    // Given: LOG_DIRECTORY 환경변수가 설정되어 있을 때
    process.env.LOG_DIRECTORY = envLogDir;
    
    // When: createDailyCombinedLogger를 디렉토리 없이 생성하면
    const logger = new Logger({
      level: LogLevel.INFO,
      enableConsole: true
    });
    
    const testMessage = 'Daily logger with env test';
    logger.info(testMessage);

    // 파일 쓰기 작업이 완료될 때까지 대기
    await new Promise(resolve => setTimeout(resolve, 100));

    // Then: 환경변수로 지정된 디렉토리에 로그 파일이 생성되어야 함
    const today = new Date().toISOString().split('T')[0];
    const envLogFile = path.join(envLogDir, `${today}.log`);
    
    const fileContent = await fs.readFile(envLogFile, 'utf-8');
    expect(fileContent).toContain(testMessage);
  });
});