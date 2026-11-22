/** @jest-environment node */
import { looksLikeMarkdown } from '../markdown-detect';
import { highlightContent } from '../highlight-config';

// Jest runs under Node; the project tsconfig has no Node types.
declare const require: (id: string) => { readFileSync(path: string, enc: string): string };
declare const __dirname: string;
const { readFileSync } = require('fs');
const root = `${__dirname}/../../..`;
const join = (...parts: string[]) => parts.join('/');

const NOTES = [
  '# Release notes',
  '',
  'Short intro paragraph.',
  '',
  '## Changes',
  '',
  '- faster startup',
  '- fewer bugs',
  '',
  '## Numbers',
  '',
  '| name | value |',
  '|------|-------|',
  '| a    | 1     |',
].join('\n');

describe('looksLikeMarkdown', () => {
  it('finds documents with headings, lists and tables', () => {
    expect(looksLikeMarkdown(NOTES)).toBe(true);
    expect(looksLikeMarkdown('# Title\n\nText with a [link](https://example.com).\n')).toBe(true);
    expect(looksLikeMarkdown('Steps:\n\n1. one\n2. **two**\n\nSee `config.yml`.\n')).toBe(true);
  });

  it('finds the repository docs', () => {
    expect(looksLikeMarkdown(readFileSync(join(root, 'README.md'), 'utf8'))).toBe(true);
    expect(looksLikeMarkdown(readFileSync(join(root, 'src/client/public/_about.md'), 'utf8'))).toBe(
      true
    );
  });

  it('ignores code inside fences', () => {
    const doc =
      '# Usage\n\n```js\nconst a = 1;\nlet b = 2;\nif (a) {\n  run();\n}\n```\n\n## More\n';
    expect(looksLikeMarkdown(doc)).toBe(true);
  });

  it.each([
    [
      'python with # comments',
      '# Config loader\nimport os\n\n## Helpers\ndef load(path):\n    data = open(path).read()\n    return data\n',
    ],
    [
      'ruby',
      '# frozen_string_literal: true\n# Greeter\nclass Greeter\n  def hi\n    puts "hi"\n  end\nend\n',
    ],
    [
      'a shell script with sections',
      '#!/bin/sh\n# Setup\n## Install\nset -e\nnpm ci\n- not a list\n- really\nexport A=1\n',
    ],
    ['C', '#include <stdio.h>\n\nint main(void) {\n  printf("hi");\n  return 0;\n}\n'],
    [
      'YAML with comments',
      '# Service\nservices:\n  web:\n    image: nginx\n    ports:\n      - 80\n      - 443\n',
    ],
    ['prose', 'Just a note about the meeting.\nNothing structured here at all.\n'],
    ['a list alone', '- milk\n- eggs\n- bread\n'],
  ])('leaves %s alone', (_, text) => {
    expect(looksLikeMarkdown(text)).toBe(false);
  });
});

describe('highlightContent', () => {
  it('detects markdown when no language is given', () => {
    expect(highlightContent(NOTES).language).toBe('markdown');
  });

  it('keeps an explicit language', () => {
    expect(highlightContent(NOTES, 'ruby').language).toBe('ruby');
  });
});
