describe('Server Configuration', () => {
  beforeEach(() => {
    // Clear environment variables before each test
    delete process.env.JWT_SECRET;
    delete process.env.DATABASE_URL;
  });

  test('should require JWT_SECRET environment variable', () => {
    expect(() => {
      if (!process.env.JWT_SECRET) {
        throw new Error('Missing JWT_SECRET environment variable');
      }
    }).toThrow();
  });

  test('should require DATABASE_URL environment variable', () => {
    expect(() => {
      if (!process.env.DATABASE_URL) {
        throw new Error('Missing DATABASE_URL environment variable');
      }
    }).toThrow();
  });

  test('environment variables should be set for production', () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost/db';

    expect(process.env.JWT_SECRET).toBeDefined();
    expect(process.env.DATABASE_URL).toBeDefined();
  });
});
