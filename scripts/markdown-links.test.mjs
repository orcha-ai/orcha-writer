import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMarkdownLink } from '../src/utils/markdownLinks.ts';

const documentPath = '/workspace/我的文档/README.md';

test('resolve a sibling file independently of the application route', () => {
  assert.deepEqual(resolveMarkdownLink('./PREFLIGHT_CHECK.md', documentPath), {
    kind: 'file', path: '/workspace/我的文档/PREFLIGHT_CHECK.md', fragment: '',
  });
});

test('resolve parent directories and decode filenames and fragments separately', () => {
  assert.deepEqual(resolveMarkdownLink('../说明%20文档.md?view=preview#安装%20说明', documentPath), {
    kind: 'file', path: '/workspace/说明 文档.md', fragment: '安装 说明',
  });
  assert.deepEqual(resolveMarkdownLink('./版本%23%25%3F.md', '/workspace/a#b%/README.md'), {
    kind: 'file', path: '/workspace/a#b%/版本#%?.md', fragment: '',
  });
});

test('resolve absolute paths and file URLs without a saved document', () => {
  for (const href of ['/docs/说明%20文档.md#安装', 'file:///docs/说明%20文档.md#安装']) {
    assert.deepEqual(resolveMarkdownLink(href), {
      kind: 'file', path: '/docs/说明 文档.md', fragment: '安装',
    });
  }
  assert.deepEqual(resolveMarkdownLink('./next.md', '/README.md'), {
    kind: 'file', path: '/next.md', fragment: '',
  });
});

test('resolve Windows paths and network file URLs', () => {
  assert.deepEqual(resolveMarkdownLink('..\\检查.md#章节', 'C:\\文档\\指南\\README.md'), {
    kind: 'file', path: 'C:/文档/检查.md', fragment: '章节',
  });
  for (const href of ['C:\\文档\\检查.md', 'file:///C:/文档/检查.md']) {
    assert.deepEqual(resolveMarkdownLink(href), { kind: 'file', path: 'C:/文档/检查.md', fragment: '' });
  }
  assert.deepEqual(resolveMarkdownLink('file://server/share/check.md'), {
    kind: 'file', path: '//server/share/check.md', fragment: '',
  });
});

test('keep fragment navigation within the document', () => {
  assert.deepEqual(resolveMarkdownLink('#%E7%AB%A0%E8%8A%82'), { kind: 'anchor', fragment: '章节' });
  assert.deepEqual(resolveMarkdownLink('#'), { kind: 'anchor', fragment: '' });
  assert.deepEqual(resolveMarkdownLink('#100%'), { kind: 'anchor', fragment: '100%' });
});

test('do not reinterpret external URLs as local files', () => {
  for (const href of ['https://example.com/docs.md#intro', 'http://example.com', '//example.com/docs.md', 'mailto:writer@example.com']) {
    assert.deepEqual(resolveMarkdownLink(href, documentPath), { kind: 'external', href });
  }
});

test('report unresolved links instead of sending them to the app router', () => {
  for (const path of [undefined, 'draft-123']) {
    assert.deepEqual(resolveMarkdownLink('./PREFLIGHT_CHECK.md', path), {
      kind: 'invalid', reason: 'missing-document-path',
    });
  }
  assert.deepEqual(resolveMarkdownLink('./invalid%FF.md', documentPath), {
    kind: 'invalid', reason: 'invalid-path',
  });
});
