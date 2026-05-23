import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: TestingModule;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
  });

  it('/ (GET)', () => {
    // This is a basic e2e test structure
    // You can add actual HTTP testing with supertest later
    expect(true).toBe(true);
  });
});
