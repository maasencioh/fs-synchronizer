// eslint-disable-next-line import/no-unassigned-import
import 'abortcontroller-polyfill/dist/abortcontroller-polyfill-only';

import { join } from 'path';

import { FileSynchronizer } from '../FileSynchronizer';
import { FileInfo, SyncOptions } from '../types';

const defaultOptions = {
  root: 'test-utils',
};

async function stub(options: SyncOptions) {
  const sync = new FileSynchronizer(options);

  const files: FileInfo[] = [];
  const excludedFiles: FileInfo[] = [];

  sync.on('file', (fileInfo) => {
    files.push(fileInfo);
  });

  sync.on('excluded-file', (fileInfo) => {
    excludedFiles.push(fileInfo);
  });

  await sync.walk();

  return {
    files,
    excludedFiles,
  };
}

test('should throws if "root" is undefined', async () => {
  const t = async () => {
    // @ts-expect-error
    await stub({ ...defaultOptions, root: undefined });
  };
  await expect(t).rejects.toThrow('root is undefined');
});
test('should throws if "maxDepth" is not an integer', async () => {
  const t = async () => {
    await stub({ ...defaultOptions, maxDepth: 4.2 });
  };
  await expect(t).rejects.toThrow('maxDepth should be an integer');
});
test('should throws if "patterns" is not an array', async () => {
  const t = async () => {
    // @ts-expect-error
    await stub({ ...defaultOptions, patterns: {} });
  };
  await expect(t).rejects.toThrow('patterns should be an array');
});
test('should match with files without patterns', async () => {
  const syncOptions: SyncOptions = defaultOptions;

  const { files, excludedFiles } = await stub(syncOptions);

  expect(files).toHaveLength(4);
  expect(excludedFiles).toHaveLength(0);
});
test('should match with exclusion, but no inclusion', async () => {
  const syncOptions: SyncOptions = {
    ...defaultOptions,
    patterns: [{ type: 'exclude', pattern: 'a*' }],
  };

  const { files, excludedFiles } = await stub(syncOptions);

  expect(files).toHaveLength(3);
  expect(excludedFiles).toHaveLength(1);
});
test('should match with inclusion, but no exclusion', async () => {
  const syncOptions: SyncOptions = {
    ...defaultOptions,
    patterns: [{ type: 'include', pattern: 'a*' }],
  };

  const { files, excludedFiles } = await stub(syncOptions);

  expect(files).toHaveLength(1);
  expect(excludedFiles).toHaveLength(3);
});
test('should match correctly with both inclusion and exclusion (include)', async () => {
  const syncOptions: SyncOptions = {
    ...defaultOptions,
    patterns: [
      { type: 'include', pattern: 'a*' },
      { type: 'exclude', pattern: '[abc]*' },
    ],
  };

  const { files, excludedFiles } = await stub(syncOptions);

  expect(files).toHaveLength(1);
  expect(excludedFiles).toHaveLength(3);
});
test('should match correctly with both inclusion and exclusion (exclude)', async () => {
  const syncOptions: SyncOptions = {
    ...defaultOptions,
    patterns: [
      { type: 'exclude', pattern: 'b*' },
      { type: 'include', pattern: '[cd]*' },
    ],
  };

  const { files, excludedFiles } = await stub(syncOptions);

  expect(files).toHaveLength(2);
  expect(excludedFiles).toHaveLength(2);
});
test('should match correctly with both inclusions and exclusion', async () => {
  const syncOptions: SyncOptions = {
    ...defaultOptions,
    patterns: [
      { type: 'include', pattern: 'a*' },
      { type: 'exclude', pattern: '[cd]*' },
      { type: 'include', pattern: 'b*' },
    ],
  };

  const { files, excludedFiles } = await stub(syncOptions);

  expect(files).toHaveLength(2);
  expect(excludedFiles).toHaveLength(2);
});
test('should match correctly with both inclusion and exclusions', async () => {
  const syncOptions: SyncOptions = {
    ...defaultOptions,
    patterns: [
      { type: 'exclude', pattern: 'a*' },
      { type: 'include', pattern: '[cd]*' },
      { type: 'exclude', pattern: 'b*' },
    ],
  };

  const { files, excludedFiles } = await stub(syncOptions);

  expect(files).toHaveLength(2);
  expect(excludedFiles).toHaveLength(2);
});
test('stop when at max depth', async () => {
  const syncOptions: SyncOptions = {
    ...defaultOptions,
    maxDepth: 1,
  };

  const { files, excludedFiles } = await stub(syncOptions);

  expect(files).toHaveLength(3);
  expect(excludedFiles).toHaveLength(0);
});
test('"end" event emitted after other events', async () => {
  expect.assertions(2);

  const syncOptions: SyncOptions = {
    ...defaultOptions,
    patterns: [{ type: 'include', pattern: '[abc].txt' }],
  };

  const sync = new FileSynchronizer(syncOptions);

  const files: FileInfo[] = [];
  const excludedFiles: FileInfo[] = [];

  sync.on('file', (fileInfo) => {
    files.push(fileInfo);
  });

  sync.on('excluded-file', (fileInfo) => {
    excludedFiles.push(fileInfo);
  });

  sync.on('end', () => {
    expect(files).toHaveLength(3);
    expect(excludedFiles).toHaveLength(1);
  });

  await sync.walk();
});
test('"end" event emitted before promise resolution', async () => {
  expect.assertions(1);

  const syncOptions: SyncOptions = {
    ...defaultOptions,
    patterns: [{ type: 'include', pattern: '[abc].txt' }],
  };

  const sync = new FileSynchronizer(syncOptions);

  let isPromiseResolved = false;

  sync.on('end', () => {
    expect(isPromiseResolved).toStrictEqual(false);
  });

  await sync.walk().then(() => (isPromiseResolved = true));
});
test("throws if root directory doesn't exist", async () => {
  const t = async () => {
    await stub({ root: 'do not exist' });
  };
  await expect(t).rejects.toThrow('ENOENT');
});
test('throws if aborted before walks', async () => {
  const sync = new FileSynchronizer(defaultOptions);

  const eventsCounts = [0, 0, 0];
  sync.on('file', () => eventsCounts[0]++);
  sync.on('excluded-file', () => eventsCounts[1]++);
  sync.on('end', () => eventsCounts[2]++);

  const controller = new AbortController();
  controller.abort();
  const t = async () => {
    await sync.walk({ signal: controller.signal });
  };
  await expect(t).rejects.toThrow('operation was aborted');
  expect(eventsCounts).toStrictEqual([0, 0, 0]);
});
test('throws if aborted during execution', async () => {
  const sync = new FileSynchronizer(defaultOptions);
  const controller = new AbortController();

  const files = [];

  let fileEventCount = 0;

  sync.on('file', (fileInfo) => {
    fileEventCount++;
    files.push(fileInfo);
    // eslint-disable-next-line jest/no-if
    if (files.length === 1) {
      controller.abort();
    }
  });

  const t = async () => {
    await sync.walk({ signal: controller.signal });
  };
  await expect(t).rejects.toThrow('operation was aborted');
  expect(fileEventCount).toBe(1);
});
test("doesn't reject if aborted after last file", async () => {
  const sync = new FileSynchronizer(defaultOptions);
  const controller = new AbortController();

  const files = [];

  sync.on('file', (fileInfo) => {
    files.push(fileInfo);
    // eslint-disable-next-line jest/no-if
    if (files.length === 4) {
      controller.abort();
    }
  });

  // Should not throw
  await sync.walk({ signal: controller.signal });
});
test('file info should be correct', async () => {
  const sync = new FileSynchronizer({
    ...defaultOptions,
    patterns: [{ type: 'include', pattern: 'a*' }],
  });

  const files: FileInfo[] = [];

  sync.on('file', (fileInfo) => {
    files.push(fileInfo);
  });

  await sync.walk();

  expect(files).toHaveLength(1);

  const [file] = files;
  expect(file.path).toBe(join(process.cwd(), 'test-utils', 'a.txt'));
  expect(file.relativePath).toBe(join('test-utils', 'a.txt'));
  expect(file.filename).toBe('a.txt');
  expect(file.extension).toBe('.txt');
  expect(file.size).toBe(491);
  expect(file.creationDate.getTime()).toBeLessThan(Date.now());
  expect(file.modificationDate.getTime()).toBeLessThan(Date.now());
  expect(typeof file.stat).toBe('object');
});
