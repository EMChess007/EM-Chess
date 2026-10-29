import { describe, expect, it } from 'vitest';
import { loadErrorMessage, SERVER_UNREACHABLE_MESSAGE } from '../loadError';

describe('loadErrorMessage', () => {
  it('says "Can\'t reach the server" for a request that never got an answer (status 0)', () => {
    expect(SERVER_UNREACHABLE_MESSAGE).toBe("Can't reach the server");
    expect(loadErrorMessage({ status: 0, message: 'Could not connect to the server. Make sure the backend is running' }, 'Failed')).toBe("Can't reach the server");
  });

  it("keeps the server's own words for an error the server answered", () => {
    expect(loadErrorMessage({ status: 500, message: 'Database is down' }, 'Failed')).toBe('Database is down');
    expect(loadErrorMessage({ status: 403, message: 'Forbidden' }, 'Failed')).toBe('Forbidden');
  });

  it('uses the screen fallback for anything else', () => {
    expect(loadErrorMessage(new Error('boom'), 'Failed to load history.')).toBe('Failed to load history.');
    expect(loadErrorMessage(null, 'Failed')).toBe('Failed');
    expect(loadErrorMessage('x', 'Failed')).toBe('Failed');
    expect(loadErrorMessage({ status: 500, message: '' }, 'Failed')).toBe('Failed');
    expect(loadErrorMessage({ status: '0', message: 'm' }, 'Failed')).toBe('Failed');
  });
});
