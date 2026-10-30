import * as assert from 'node:assert/strict';
import { resolveLink } from '../../src/preview/links';

const DOCUMENT = 'file:///c%3A/docs/guide/doc.md';

describe('resolveLink', () => {
	it('takes an anchor alone as one in the same document', () => {
		assert.deepEqual(resolveLink('#usage', DOCUMENT), { kind: 'anchor', anchor: 'usage' });
	});

	it('decodes the anchor', () => {
		assert.deepEqual(resolveLink('#a%20b', DOCUMENT), { kind: 'anchor', anchor: 'a b' });
	});

	it('takes a link to the document itself as an anchor in it', () => {
		assert.deepEqual(resolveLink('doc.md#usage', DOCUMENT), { kind: 'anchor', anchor: 'usage' });
		assert.deepEqual(resolveLink('./doc.md', DOCUMENT), { kind: 'anchor', anchor: '' });
	});

	it('resolves a Markdown file against the folder of the document', () => {
		assert.deepEqual(resolveLink('../other.md#part', DOCUMENT), {
			kind: 'markdown',
			uri: 'file:///c%3A/docs/other.md',
			anchor: 'part',
		});
	});

	it('recognises a Markdown file by the extension md in any case, without an anchor too', () => {
		assert.deepEqual(resolveLink('sub/README.MD', DOCUMENT), {
			kind: 'markdown',
			uri: 'file:///c%3A/docs/guide/sub/README.MD',
			anchor: '',
		});
	});

	it('takes an absolute file address as it is', () => {
		assert.deepEqual(resolveLink('file:///c%3A/other/notes.md', DOCUMENT), {
			kind: 'markdown',
			uri: 'file:///c%3A/other/notes.md',
			anchor: '',
		});
	});

	it('encodes a relative path the way an address needs it', () => {
		assert.deepEqual(resolveLink('my notes.md', DOCUMENT), {
			kind: 'markdown',
			uri: 'file:///c%3A/docs/guide/my%20notes.md',
			anchor: '',
		});
	});

	it('takes any other file as a file for its default editor', () => {
		assert.deepEqual(resolveLink('pictures/a.png', DOCUMENT), {
			kind: 'file',
			uri: 'file:///c%3A/docs/guide/pictures/a.png',
		});
		assert.deepEqual(resolveLink('notes.markdown', DOCUMENT), {
			kind: 'file',
			uri: 'file:///c%3A/docs/guide/notes.markdown',
		});
	});

	it('takes an http or https address as a web address', () => {
		assert.deepEqual(resolveLink('https://example.com/a?b=c#d', DOCUMENT), {
			kind: 'web',
			uri: 'https://example.com/a?b=c#d',
		});
		assert.deepEqual(resolveLink('http://example.com', DOCUMENT), { kind: 'web', uri: 'http://example.com/' });
	});

	it('leaves an address of another scheme to the system', () => {
		assert.deepEqual(resolveLink('mailto:someone@example.com', DOCUMENT), {
			kind: 'external',
			uri: 'mailto:someone@example.com',
		});
	});

	it('ignores data and script addresses and empty links', () => {
		assert.deepEqual(resolveLink('data:image/png;base64,AAAA', DOCUMENT), { kind: 'ignore' });
		assert.deepEqual(resolveLink('javascript:alert(1)', DOCUMENT), { kind: 'ignore' });
		assert.deepEqual(resolveLink('', DOCUMENT), { kind: 'ignore' });
	});

	it('ignores a relative link in a document without a folder, but scrolls to an anchor in it', () => {
		assert.deepEqual(resolveLink('other.md', 'untitled:Untitled-1'), { kind: 'ignore' });
		assert.deepEqual(resolveLink('#usage', 'untitled:Untitled-1'), { kind: 'anchor', anchor: 'usage' });
	});
});
