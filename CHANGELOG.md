# Changelog

All notable changes to this crate are documented in this file.

The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this crate adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Re-export all published library crates at the top level
  (`philharmonic::types`, `philharmonic::store`,
  `philharmonic::api`, etc.).
- Feature-gate connector implementations: six shipped impls
  are default-on; three unshipped impls (`llm-anthropic`,
  `llm-gemini`, `email-smtp`) are off by default until their
  0.1.0 lands. Use `default-features = false` to pick
  individually.
- Added `https` feature forwarding to `mechanics/https` for
  TLS support in bin targets (bin targets not yet added).

Note: publishing this crate requires the three unshipped
connector impl crates to be published as placeholders first
(even as 0.0.0), since `cargo publish` resolves all
dependencies including optional ones against the registry.

## [0.0.0]

Name reservation on crates.io. No functional content yet.
