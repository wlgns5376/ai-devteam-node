import * as fs from 'fs';
import * as path from 'path';

describe('Project Setup Validation', () => {
  const projectRoot = path.resolve(__dirname, '../..');

  describe('Configuration Files', () => {
    it('should have package.json with correct configuration', () => {
      // Given
      const packageJsonPath = path.join(projectRoot, 'package.json');

      // When
      const packageJsonExists = fs.existsSync(packageJsonPath);

      // Then
      expect(packageJsonExists).toBe(true);

      if (packageJsonExists) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        expect(packageJson.name).toBe('ai-devteam-node');
        expect(packageJson.main).toBe('dist/index.js');
        expect(packageJson.engines.node).toBe('>=20.0.0');
      }
    });

    it('should have TypeScript configuration', () => {
      // Given
      const tsconfigPath = path.join(projectRoot, 'tsconfig.json');

      // When
      const tsconfigExists = fs.existsSync(tsconfigPath);

      // Then
      expect(tsconfigExists).toBe(true);

      if (tsconfigExists) {
        const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
        expect(tsconfig.compilerOptions.target).toBe('ES2022');
        expect(tsconfig.compilerOptions.outDir).toBe('./dist');
        expect(tsconfig.compilerOptions.rootDir).toBe('./src');
        expect(tsconfig.compilerOptions.strict).toBe(true);
      }
    });

    it('should have Jest configuration', () => {
      // Given
      const jestConfigPath = path.join(projectRoot, 'jest.config.js');

      // When
      const jestConfigExists = fs.existsSync(jestConfigPath);

      // Then
      expect(jestConfigExists).toBe(true);
    });

    it('should have ESLint configuration', () => {
      // Given
      const eslintConfigPath = path.join(projectRoot, '.eslintrc.js');

      // When
      const eslintConfigExists = fs.existsSync(eslintConfigPath);

      // Then
      expect(eslintConfigExists).toBe(true);
    });

    it('should have Prettier configuration', () => {
      // Given
      const prettierConfigPath = path.join(projectRoot, '.prettierrc');

      // When
      const prettierConfigExists = fs.existsSync(prettierConfigPath);

      // Then
      expect(prettierConfigExists).toBe(true);
    });
  });

  describe('Directory Structure', () => {
    const expectedDirectories = [
      'src',
      'src/components',
      'src/services',
      'src/types',
      'src/utils',
      'tests',
      'tests/unit',
      'tests/integration',
      'tests/fixtures',
      'docs',
      'logs'
    ];

    expectedDirectories.forEach(dir => {
      it(`should have ${dir} directory`, () => {
        // Given
        const dirPath = path.join(projectRoot, dir);

        // When
        const dirExists = fs.existsSync(dirPath);

        // Then
        expect(dirExists).toBe(true);
      });
    });

    it('should have main entry point', () => {
      // Given
      const indexPath = path.join(projectRoot, 'src', 'index.ts');

      // When
      const indexExists = fs.existsSync(indexPath);

      // Then
      expect(indexExists).toBe(true);
    });
  });

  describe('Dependencies', () => {
    it('should have all required production dependencies', () => {
      // Given
      const packageJsonPath = path.join(projectRoot, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      const requiredDeps = [
        '@octokit/rest',
        'simple-git',
        'commander',
        'winston',
        'dotenv'
      ];

      // When & Then
      requiredDeps.forEach(dep => {
        expect(packageJson.dependencies).toHaveProperty(dep);
      });
    });

    it('should have all required development dependencies', () => {
      // Given
      const packageJsonPath = path.join(projectRoot, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      const requiredDevDeps = [
        'typescript',
        '@types/node',
        'ts-node',
        'tsx',
        'jest',
        '@types/jest',
        'ts-jest',
        '@typescript-eslint/parser',
        '@typescript-eslint/eslint-plugin',
        'eslint',
        'prettier'
      ];

      // When & Then
      requiredDevDeps.forEach(dep => {
        expect(packageJson.devDependencies).toHaveProperty(dep);
      });
    });
  });
});