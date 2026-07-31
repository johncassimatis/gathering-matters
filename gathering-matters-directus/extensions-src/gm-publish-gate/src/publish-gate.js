// Pure editorial-gate logic: decides a file's release folder/state from the
// combination of malware scan result + editorial state. No Directus/AWS deps.
//
// The single rule this proves and enforces:
//   A file may be in "Public Downloads" (publicly readable) ONLY when ALL hold:
//     1. scanStatus === 'NO_THREATS_FOUND'   (malware-clean)
//     2. published === true                  (content item published)
//     3. isDownload === true                 (explicit download approval)
//     4. associationActive === true          (file still linked to the item)
//   - A malware-clean file with editorial conditions unmet goes to
//     "Clean Staff Review" (staff can review, public cannot download).
//   - Any non-clean / unknown scan status goes to "Pending Malware Scan"
//     (inaccessible to everyone but admins), regardless of editorial state -
//     editorial approval can NEVER override a non-clean scan.
//   - Removing publication or download approval recomputes to a LESS permissive
//     folder (immediate revocation).

export function isClean(scanStatus) { return scanStatus === 'NO_THREATS_FOUND'; }

export function isPubliclyDownloadable({ scanStatus, published, isDownload, associationActive }) {
  return isClean(scanStatus) && published === true && isDownload === true && associationActive === true;
}

// folders: { pending, review, public } (folder IDs). Returns the folder the file
// should live in. Fail-closed: anything not fully clean -> pending.
export function targetFolderFor(state, folders) {
  if (!isClean(state.scanStatus)) return folders.pending;
  if (isPubliclyDownloadable(state)) return folders.public;
  return folders.review;
}
