import { main } from '../../src/index';

describe('AI DevTeam Main', () => {
  describe('main function', () => {
    it('should execute without errors', () => {
      // Given
      const consoleLogSpy = jest.spyOn(console, 'log');

      // When
      expect(() => main()).not.toThrow();

      // Then
      expect(consoleLogSpy).toHaveBeenCalledWith('AI DevTeam System Starting...');
    });

    it('should log startup message', () => {
      // Given
      const consoleLogSpy = jest.spyOn(console, 'log');

      // When
      main();

      // Then
      expect(consoleLogSpy).toHaveBeenCalledWith('AI DevTeam System Starting...');
    });
  });
});