/**
 * test/unit/TokenBudgetService.test.js — P0#2
 */
'use strict';

jest.setTimeout(10000);

// Mock Redis
const mockPipeline = {
  incrby: jest.fn().mockReturnThis(),
  expire: jest.fn().mockReturnThis(),
  exec: jest.fn(),
};
const mockRedis = {
  get: jest.fn(),
  del: jest.fn(),
  pipeline: jest.fn(() => mockPipeline),
};
jest.mock('../../src/redis/client', () => ({ getRedis: () => mockRedis }));

const {
  getUsage, incrementUsage, checkBudget, resetUsage,
} = require('../../src/services/TokenBudgetService');

beforeEach(() => jest.clearAllMocks());

describe('TokenBudgetService — P0#2', () => {
  test('getUsage returns 0 when key missing', async () => {
    mockRedis.get.mockResolvedValue(null);
    expect(await getUsage('agent-1')).toBe(0);
  });

  test('getUsage returns parsed integer', async () => {
    mockRedis.get.mockResolvedValue('1500');
    expect(await getUsage('agent-1')).toBe(1500);
  });

  test('incrementUsage calls INCRBY + EXPIRE pipeline', async () => {
    mockPipeline.exec.mockResolvedValue([[null, 2048]]);
    await incrementUsage('agent-1', 512);
    expect(mockPipeline.incrby).toHaveBeenCalledWith(expect.stringContaining('agent-1'), 512);
    expect(mockPipeline.expire).toHaveBeenCalledWith(
      expect.stringContaining('agent-1'),
      30 * 24 * 60 * 60
    );
  });

  test('checkBudget: allowed when usage + estimate <= budget', async () => {
    mockRedis.get.mockResolvedValue('500');
    const agent = { id: 'a1', max_token_budget: 2000 };
    const r = await checkBudget(agent, 1000);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(1500);
  });

  test('checkBudget: BLOCKED when estimate exceeds remaining', async () => {
    mockRedis.get.mockResolvedValue('1900');
    const agent = { id: 'a1', max_token_budget: 2000 };
    const r = await checkBudget(agent, 1024);  // needs 1024, only 100 left
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(100);
  });

  test('checkBudget: allowed (no-budget) when agent has no max_token_budget', async () => {
    const agent = { id: 'a2', max_token_budget: null };
    const r = await checkBudget(agent, 9999);
    expect(r.allowed).toBe(true);
    expect(r.budget).toBeNull();
  });

  test('resetUsage calls DEL on the agent key', async () => {
    mockRedis.del.mockResolvedValue(1);
    await resetUsage('agent-x');
    expect(mockRedis.del).toHaveBeenCalledWith(expect.stringContaining('agent-x'));
  });
});
