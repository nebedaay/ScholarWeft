import { customNoteTemplatePath, templateCopyPath } from '../note-template';

describe('customNoteTemplatePath', () => {
  it('uses the bundled template by default', () => {
    expect(customNoteTemplatePath({})).toBeNull();
    expect(
      customNoteTemplatePath({
        useDefaultNoteTemplate: true,
        noteTemplatePath: 'Templates/sw-note.eta.md',
      })
    ).toBeNull();
  });

  it('uses the custom path only when the default template is off', () => {
    expect(
      customNoteTemplatePath({
        useDefaultNoteTemplate: false,
        noteTemplatePath: '  Templates/sw-note.eta.md  ',
      })
    ).toBe('Templates/sw-note.eta.md');
  });

  it('falls back to the bundled template when the default is off but no path is set', () => {
    expect(
      customNoteTemplatePath({ useDefaultNoteTemplate: false, noteTemplatePath: '   ' })
    ).toBeNull();
    expect(customNoteTemplatePath({ useDefaultNoteTemplate: false })).toBeNull();
  });
});

describe('templateCopyPath', () => {
  it('writes to the vault root when no folder is given', () => {
    expect(templateCopyPath('', [])).toBe('sw-note.eta.md');
    expect(templateCopyPath('/', [])).toBe('sw-note.eta.md');
  });

  it('places the copy in the chosen folder', () => {
    expect(templateCopyPath('Templates', [])).toBe('Templates/sw-note.eta.md');
  });

  it('avoids colliding with an existing file', () => {
    expect(templateCopyPath('Templates', ['Templates/sw-note.eta.md'])).toBe(
      'Templates/sw-note-2.eta.md'
    );
    expect(
      templateCopyPath('Templates', [
        'Templates/sw-note.eta.md',
        'Templates/sw-note-2.eta.md',
      ])
    ).toBe('Templates/sw-note-3.eta.md');
  });
});
