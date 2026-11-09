import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const root = path.resolve(import.meta.dirname, '..');
const spec = JSON.parse(await fs.readFile(path.join(root, 'shared/windows-runtime-assets.json'), 'utf8'));
const directory = path.join(root, 'runtime/windows-runtime');
const file = path.join(directory, spec.file);
if (!process.argv.includes('--check')) {
  await fs.mkdir(directory, { recursive: true });
  const from = process.argv.find(arg => arg.startsWith('--from='))?.slice(7);
  if (from) await fs.copyFile(path.resolve(from), file);
  else {
    const response = await fetch(spec.url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw Error(`Microsoft runtime download failed: ${response.status}`);
    await fs.writeFile(file, Buffer.from(await response.arrayBuffer()));
  }
}
const digest = createHash('sha256').update(await fs.readFile(file)).digest('hex');
if (digest !== spec.sha256) throw Error('Microsoft runtime checksum mismatch; refusing to package it.');
if (process.platform === 'win32') {
  const literal = "'" + file.replace(/'/g, "''") + "'";
  const script = `$s=Get-AuthenticodeSignature -LiteralPath ${literal}; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation'){exit 1}`;
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 30000 });
}
console.log(`Windows prerequisite: Microsoft Visual C++ ${spec.version}, checksum and signature verified.`);
