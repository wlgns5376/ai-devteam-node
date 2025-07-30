import fs from 'fs/promises';
import path from 'path';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export interface LoggerConfig {
  level: LogLevel;
  filePath?: string;
  logDirectory?: string;
  enableConsole?: boolean;
}

export interface LogContext {
  [key: string]: unknown;
}

export class Logger {
  private readonly config: Required<LoggerConfig>;
  private readonly logLevelNames = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

  constructor(config: LoggerConfig) {
    this.config = {
      level: config.level,
      filePath: config.filePath || '',
      logDirectory: config.logDirectory || '',
      enableConsole: config.enableConsole ?? true
    };
  }

  debug(message: string, context?: LogContext): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log(LogLevel.ERROR, message, context);
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    // 설정된 로그 레벨보다 낮은 레벨은 무시
    if (level < this.config.level) {
      return;
    }

    const timestamp = new Date().toISOString();
    const levelName = this.logLevelNames[level] || 'UNKNOWN';
    const contextStr = context ? this.formatContext(context) : '';
    const logMessage = `${timestamp} [${levelName}] ${message}${contextStr}`;

    // 콘솔 출력
    if (this.config.enableConsole) {
      console.log(logMessage);
    }

    // 파일 출력
    if (this.config.filePath || this.config.logDirectory) {
      this.writeToFile(logMessage);
    }
  }

  private formatContext(context: LogContext): string {
    try {
      const formatted = JSON.stringify(context, this.errorReplacer, 2);
      return ` ${formatted}`;
    } catch (error) {
      // 순환 참조 등의 오류 처리
      return ` [Context serialization failed: ${error instanceof Error ? error.message : 'Unknown error'}]`;
    }
  }

  private errorReplacer(key: string, value: unknown): unknown {
    // Error 객체를 직렬화 가능한 형태로 변환
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack
      };
    }
    return value;
  }

  private getCurrentLogFilePath(): string {
    // logDirectory가 설정되어 있으면 일자별 파일 경로 생성
    if (this.config.logDirectory) {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD 형식
      return path.join(this.config.logDirectory, `${today}.log`);
    }
    // 기존 filePath 방식 (하위 호환성)
    return this.config.filePath;
  }

  private async ensureLogDirectory(): Promise<void> {
    const logFilePath = this.getCurrentLogFilePath();
    if (!logFilePath) return;

    try {
      const logDir = path.dirname(logFilePath);
      await fs.mkdir(logDir, { recursive: true });
    } catch (error) {
      // 디렉토리 생성 실패 시 콘솔에만 경고 출력
      if (this.config.enableConsole) {
        console.warn(`Failed to create log directory: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  private async writeToFile(message: string): Promise<void> {
    const logFilePath = this.getCurrentLogFilePath();
    if (!logFilePath) return;

    try {
      // 디렉토리가 없으면 생성
      await this.ensureLogDirectory();
      await fs.appendFile(logFilePath, `${message}\n`);
    } catch (error) {
      // 파일 쓰기 실패 시 콘솔에만 경고 출력 (순환 참조 방지)
      if (this.config.enableConsole) {
        console.warn(`Failed to write to log file: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  // 정적 팩토리 메서드들
  static createConsoleLogger(level: LogLevel = LogLevel.INFO): Logger {
    return new Logger({
      level,
      enableConsole: true
    });
  }

  static createFileLogger(filePath: string, level: LogLevel = LogLevel.INFO): Logger {
    return new Logger({
      level,
      filePath,
      enableConsole: false
    });
  }

  static createCombinedLogger(filePath: string, level: LogLevel = LogLevel.INFO): Logger {
    return new Logger({
      level,
      filePath,
      enableConsole: true
    });
  }

  static createDailyLogger(logDirectory: string, level: LogLevel = LogLevel.INFO): Logger {
    return new Logger({
      level,
      logDirectory,
      enableConsole: false
    });
  }

  static createDailyCombinedLogger(logDirectory: string, level: LogLevel = LogLevel.INFO): Logger {
    return new Logger({
      level,
      logDirectory,
      enableConsole: true
    });
  }
}