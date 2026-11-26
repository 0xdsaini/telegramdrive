import {
  folderUploadWithoutDirectoryPickerHint,
  isBraveBrowserSync,
} from './localDirectoryUpload';

describe('folderUploadWithoutDirectoryPickerHint', () => {
  const originalUA = navigator.userAgent;

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUA,
      configurable: true,
    });
  });

  it('mentions Brave flag when UA is Brave', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Brave/120.0.0.0',
      configurable: true,
    });
    expect(isBraveBrowserSync()).toBe(true);
    expect(folderUploadWithoutDirectoryPickerHint()).toMatch(/File System Access API/);
    expect(folderUploadWithoutDirectoryPickerHint()).toMatch(/Finder/);
  });

  it('mentions Finder on macOS non-Brave', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      configurable: true,
    });
    expect(isBraveBrowserSync()).toBe(false);
    expect(folderUploadWithoutDirectoryPickerHint()).toMatch(/Finder/);
  });
});