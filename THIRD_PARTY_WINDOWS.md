# Windows prerequisite

Windows x64 packages include the unmodified Microsoft Visual C++ v14 x64 Redistributable, version 14.51.36247.0. Its URL, publisher and SHA-256 are pinned in `shared/windows-runtime-assets.json`; the packaging check verifies the checksum and Microsoft Authenticode signature.

The caption executable is probed before the packaged app starts its server. Only native missing/outdated-DLL errors trigger the bundled Microsoft installer. It uses `/install /quiet /norestart`, requests Windows elevation, never removes a newer runtime, and probes again afterward. A working runtime requires no installation or elevation. Installation is offline; Windows may request administrator consent. The app never restarts Windows itself.

Microsoft retains ownership of the prerequisite and its license terms. The installer contains the Microsoft Software License Terms. See [Microsoft's deployment documentation](https://learn.microsoft.com/en-us/cpp/windows/deployment-in-visual-cpp) and [Visual C++ redistribution documentation](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files).

To provision a build machine: `npm run setup:captions`, then `npm run setup:windows`. `setup:windows` accepts `--from=<official installer path>` for an offline build. Every package command checks both native resources; a missing or changed prerequisite stops packaging.
