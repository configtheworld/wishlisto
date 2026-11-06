# Changelog

All notable changes to this project are documented here. The project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Group sharing with invite links, public view-only links, and hidden claims (surprise, claimed, or visible to the owner).
- Link previews that read only the page title and description, with SSRF protections; "Fill from link" in the item form.
- Admin page: signup toggle, user list, temporary password reset, and a campaign bar for the home pages.
- Turkish, German and English interface.
- Configurable app name, copy and colours in `site.json`. Avatars use DiceBear's Identicon style.
- Continuous integration (typecheck, tests, build, dependency audit, container build) and weekly dependency updates.

### Changed
- Redesigned lists, groups and home page; the account menu holds settings, theme, language and log out.

### Removed
- Footer, language picker on the settings page, and unused translations and styles.
