import { Command } from '@/types/developer.types';

export interface ParsedOutput {
  success: boolean;
  prLink?: string | undefined;
  commitHash?: string | undefined;
  commands: Command[];
  modifiedFiles: string[];
}

export class ResponseParser {
  extractPrLink(output: string): string | undefined {
    const prRegex = /https:\/\/github\.com\/[\w-]+\/[\w-]+\/pull\/\d+/g;
    const matches = output.match(prRegex);
    return matches ? matches[0] : undefined;
  }

  extractCommitHash(output: string): string | undefined {
    const commitRegex = /\b[0-9a-f]{40}\b/g;
    const matches = output.match(commitRegex);
    return matches ? matches[0] : undefined;
  }

  extractCommands(output: string): Command[] {
    const commands: Command[] = [];
    const lines = output.split('\n');
    
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line) {
        i++;
        continue;
      }
      
      const trimmedLine = line.trim();
      
      // 명령어 시작 패턴: $ 로 시작하는 줄
      if (trimmedLine.startsWith('$')) {
        const command = trimmedLine.substring(1).trim();
        const outputLines: string[] = [];
        
        // 다음 줄부터 출력 수집
        i++;
        while (i < lines.length) {
          const nextLine = lines[i];
          if (!nextLine) {
            i++;
            continue;
          }
          
          // 다음 명령어를 만나면 중단
          if (nextLine.trim().startsWith('$')) {
            break;
          }
          
          outputLines.push(nextLine);
          i++;
        }
        
        // 출력 끝부분의 빈 줄 제거
        while (outputLines.length > 0) {
          const lastLine = outputLines[outputLines.length - 1];
          if (lastLine && lastLine.trim() === '') {
            outputLines.pop();
          } else {
            break;
          }
        }
        
        commands.push(this.createCommand(command, outputLines.join('\n')));
      } else {
        i++;
      }
    }
    
    return commands;
  }

  extractModifiedFiles(output: string): string[] {
    const files = new Set<string>();
    
    // git status 패턴
    const statusPatterns = [
      /new file:\s+(.+)/g,
      /modified:\s+(.+)/g,
      /deleted:\s+(.+)/g,
      /renamed:\s+(.+)/g
    ];
    
    // git status 패턴 매칭
    for (const pattern of statusPatterns) {
      let match;
      while ((match = pattern.exec(output)) !== null) {
        if (match[1]) {
          const file = match[1].trim();
          // 확장자가 있는 파일만 추가
          if (file.includes('.')) {
            files.add(file);
          }
        }
      }
    }
    
    // git diff 출력에서 파일 추출 (diff --git a/file b/file 형식)
    const diffPatterns = [
      /diff --git a\/(.+) b\/(.+)/g,
      /\+\+\+ b\/(.+)/g
    ];
    
    for (const pattern of diffPatterns) {
      let match;
      while ((match = pattern.exec(output)) !== null) {
        if (match[1]) {
          const file = match[1].trim();
          if (file.includes('.') && !file.includes('/dev/null')) {
            files.add(file);
          }
        }
      }
    }
    
    // git diff --name-only 스타일 파일 목록
    const lines = output.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // 파일 경로 패턴 확인 (확장자 포함)
      if (trimmed && 
          trimmed.includes('.') && 
          !trimmed.startsWith('$') && // 명령어 제외
          !trimmed.includes('git diff') && // git diff 명령어 제외
          trimmed.match(/^[\w\-\/\.]+$/)) { // 기본적인 파일 경로 패턴
        files.add(trimmed);
      }
    }
    
    return Array.from(files);
  }

  isSuccess(output: string): boolean {
    const successKeywords = [
      'success',
      'succeeded',
      'completed',
      'passed',
      'created pr',
      '완료'
    ];
    
    const failureKeywords = [
      'error',
      'failed',
      'failure',
      'npm err!',
      'exit status 1',
      'command failed'
    ];
    
    const lowerOutput = output.toLowerCase();
    
    // 실패 키워드가 있으면 실패
    for (const keyword of failureKeywords) {
      if (lowerOutput.includes(keyword)) {
        return false;
      }
    }
    
    // 성공 키워드가 있으면 성공
    for (const keyword of successKeywords) {
      if (lowerOutput.includes(keyword)) {
        return true;
      }
    }
    
    // 기본값은 true (명시적 실패가 없으면 성공으로 간주)
    return true;
  }

  parseOutput(output: string): ParsedOutput {
    return {
      success: this.isSuccess(output),
      prLink: this.extractPrLink(output),
      commitHash: this.extractCommitHash(output),
      commands: this.extractCommands(output),
      modifiedFiles: this.extractModifiedFiles(output)
    };
  }

  private createCommand(command: string, output: string): Command {
    // Exit code 추출
    let exitCode = 0;
    
    if (output.toLowerCase().includes('error') || 
        output.includes('Exit status 1') ||
        output.includes('npm ERR!')) {
      exitCode = 1;
    }
    
    return {
      command,
      output: output.trim(),
      exitCode,
      timestamp: new Date()
    };
  }
}