import { createEmptyFileStructure, findFolderByPath } from '../utils/fileStructureUtils';
import { planFolderUpload } from '../utils/folderUpload';
import { supportsDirectoryPicker } from '../utils/localDirectoryUpload';

export const DEV_FOLDER_UPLOAD_FIXTURE = {
  originalRootName: 'tmp-folder-upload-test',
  emptyDirectoryPaths: ['with-empty/empty-sub', 'empty-only'],
};

function makeTestFile(name, relativePath, content = 'test\n') {
  const file = new File([content], name, { type: 'text/plain' });
  Object.defineProperty(file, 'webkitRelativePath', {
    value: relativePath,
    configurable: true,
    enumerable: true,
  });
  return file;
}

export function buildDevFolderUploadFixturePayload() {
  const root = DEV_FOLDER_UPLOAD_FIXTURE.originalRootName;
  return {
    files: [
      makeTestFile('test.txt', `${root}/test.txt`),
      makeTestFile('nested.txt', `${root}/with-empty/nested.txt`),
    ],
    emptyDirectoryPaths: [...DEV_FOLDER_UPLOAD_FIXTURE.emptyDirectoryPaths],
    originalRootName: root,
  };
}

/**
 * Dev: verify folder upload planning; optionally run the real upload (UI + Telegram).
 * @param {{ apply?: boolean, skipCollisionConfirm?: boolean }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function runFolderUploadDevBrowserTest(options = {}) {
  const { apply = true, skipCollisionConfirm = true } = options;
  const explorer = typeof window.__devFolderUploadState === 'function'
    ? window.__devFolderUploadState()
    : null;

  const tree = explorer?.fileStructure ?? createEmptyFileStructure();
  const currentPath = explorer?.currentPath ?? '/';
  const payload = buildDevFolderUploadFixturePayload();
  const root = payload.originalRootName;

  const plan = planFolderUpload(tree, currentPath, payload);

  const resolvedRootName = plan.ok ? plan.resolvedRootName : root;
  const resolvedRootPath =
    currentPath === '/' ? `/${resolvedRootName}` : `${currentPath}/${resolvedRootName}`;

  const checks = {
    planOk: plan.ok === true,
    fileEntries: plan.ok ? plan.entries.length : 0,
    emptyFolderCount: plan.ok ? plan.emptyFolderCount : 0,
    hasRoot: plan.ok ? Boolean(findFolderByPath(plan.structureWithFolders, resolvedRootPath)) : false,
    hasEmptySub: plan.ok
      ? Boolean(findFolderByPath(plan.structureWithFolders, `${resolvedRootPath}/with-empty/empty-sub`))
      : false,
    hasEmptyOnly: plan.ok
      ? Boolean(findFolderByPath(plan.structureWithFolders, `${resolvedRootPath}/empty-only`))
      : false,
    nestedFilePath:
      plan.ok && plan.entries.length >= 2 ? plan.entries[1].targetFolderPath : null,
    supportsDirectoryPicker: supportsDirectoryPicker(),
    explorerReady: Boolean(explorer?.isConnected && explorer?.selectedChatId),
  };

  const expectedNested =
    plan.ok && plan.entries.length >= 2 ? plan.entries[1].targetFolderPath : null;
  checks.nestedFilePathOk =
    expectedNested != null && checks.nestedFilePath === `${resolvedRootPath}/with-empty`;

  const passed =
    checks.planOk &&
    checks.fileEntries === 2 &&
    checks.emptyFolderCount === 2 &&
    checks.hasRoot &&
    checks.hasEmptySub &&
    checks.hasEmptyOnly &&
    checks.nestedFilePathOk;

  const result = {
    passed,
    checks,
    plan: plan.ok
      ? {
          resolvedRootName: plan.resolvedRootName,
          resolvedRootPath,
          entries: plan.entries.map((e) => ({
            filename: e.filename,
            targetFolderPath: e.targetFolderPath,
          })),
        }
      : plan,
    applied: false,
    upload: null,
  };

  if (!apply) {
    result.note = 'Planning only (apply: false). Pass { apply: true } to upload and update the UI.';
    console.log('[folderUploadDevBrowserTest]', result);
    return result;
  }

  const applyFn = window.__devApplyFolderUpload;
  if (!applyFn) {
    result.note =
      'Planner OK but file explorer is not active. Sign in, wait for sync, then run again.';
    console.warn('[folderUploadDevBrowserTest]', result);
    return result;
  }

  if (!checks.explorerReady) {
    result.note = 'Connect to Telegram and select your drive group, then run again.';
    console.warn('[folderUploadDevBrowserTest]', result);
    return result;
  }

  result.upload = await applyFn(payload, { skipCollisionConfirm });
  result.applied = Boolean(result.upload?.ok || result.upload?.uploaded >= 0);
  result.note = result.upload?.ok
    ? `Uploaded to ${result.upload.resolvedRootPath ?? resolvedRootPath}. Check the file explorer.`
    : 'Upload did not complete; see upload result and on-screen error banner.';

  console.log('[folderUploadDevBrowserTest]', result);
  return result;
}

export function attachFolderUploadDevBrowserTest() {
  if (process.env.NODE_ENV !== 'development') {
    return;
  }
  window.runFolderUploadDevBrowserTest = runFolderUploadDevBrowserTest;
  window.buildDevFolderUploadFixturePayload = buildDevFolderUploadFixturePayload;
}