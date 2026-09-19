# Beta tester downloads and packaging

The [v0.5.0 Beta 1 download page](https://github.com/SkinnyFatBoy05/interlude/releases/tag/v0.5.0-beta.1) provides the four tester ZIPs. This repository is public; published release downloads can be shared without inviting friends as collaborators. The release is an experimental prerelease for a small guided test group, not a supported public launch.

The 0.5.0 kits reuse immutable runtime artifacts from verified build `4da4458`, run [35431131647](https://github.com/SkinnyFatBoy05/interlude/actions/runs/35431131647). No runtime rebuild is needed for changes only to tester instructions. `docs/beta-build.json` pins the version, commit, workflow run and required checks; update it only after a new runtime build passes.

## Assemble

Download these four artifacts from that run into `artifacts/verified-0.5.0`, retaining their artifact-name subfolders:

```sh
gh run download 35431131647 --repo SkinnyFatBoy05/interlude --name interlude-desktop-Windows-X64 --name interlude-desktop-macOS-ARM64 --name interlude-desktop-macOS-X64 --name interlude-Linux-X64 --dir artifacts/verified-0.5.0
```

Save the run's `databaseId`, `headSha`, `status`, `conclusion`, `url`, and jobs' `name/status/conclusion` as `artifacts/verified-0.5.0/build-record.json` using `gh run view --json`. Then run:

```sh
npm run package:beta -- artifacts/verified-0.5.0
```

The packager requires the pinned successful run and all ten successful jobs, checks the CI checksums and extension version/contents, and creates a new `artifacts/tester-kit-0.5.0` directory. It refuses to overwrite an existing kit. An optional second argument chooses another NEW directory under `artifacts`. It does not install apps/hooks, publish a release, change repository visibility, invite collaborators or send files.

## Send the right ZIP

- `Interlude-0.5.0-beta-browser.zip`: Claude/Codex websites on Windows or Mac; extension only.
- `Interlude-0.5.0-beta-windows-x64.zip`: Windows 10/11 x64 desktop applications, plus the extension.
- `Interlude-0.5.0-beta-mac-arm64.zip`: Apple Silicon Mac, macOS 13+.
- `Interlude-0.5.0-beta-mac-x64.zip`: Intel Mac, macOS 13+.

Each ZIP contains START-HERE.txt, FEEDBACK.txt, privacy/known-limit documents, extension files, the build record and SHA-256 checksums. Desktop kits add the exact installer from CI. The top-level SHA256SUMS.txt checks the four ZIPs. The owner can copy INVITE.txt as the invitation. Send the release-page link or the appropriate ZIP. GitHub Actions artifacts expire and require GitHub sign-in to download; published release assets provide the shareable download instead. The included guide's “private preview” wording describes the limited testing audience, not access restrictions on these public downloads.

## First wave and decision

Invite a small guided group, ideally one Windows, one Apple Silicon and one Intel Mac tester. Start with YouTube and one assistant surface per session. Have someone test each advertised surface and return the provided feedback. Record failures and NOT TESTED separately from passes. Do not promise compatibility merely because an adapter is registered.

Stop expanding the test group for unexpected playback, a wrong-window return, a hold that cannot be released, hook/settings damage or any private-content disclosure. Fix and repeat the affected flow before continuing. A setup block caused by unsigned/notarized status is a reported installation limitation; do not tell testers to disable OS protections.

The experimental prerelease can be shared for exploratory compatibility testing with those limitations disclosed. Broader beta readiness still requires clean-machine install/upgrade/uninstall, real account flows on every claimed assistant, actual Mac Accessibility/Spaces and display behavior, and target media acceptance. A supported public launch additionally needs trusted signing, notarization and browser-store review. No live acceptance results are prefilled in the kit.
