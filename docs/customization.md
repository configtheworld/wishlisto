# Customisation

Most of what visitors see can be changed without touching code: the app name, the tagline, the landing page and the colours. The admin can also show a short message on the home pages.

## site.json

The file is read at startup from `SITE_CONFIG` (default `site.json` in the working directory; the Docker image includes the default). An invalid file stops the server and says what is wrong.

```json
{
  "appName": "Wishlisto",
  "tagline": { "en": "Little wishlists for the people you love." },
  "landing": {
    "title": { "en": "Plan gifts together, without spoiling the surprise." },
    "intro": { "en": "Wishlisto is a small, self-hosted wishlist app. …" },
    "features": [
      { "icon": "lock", "title": { "en": "Private by default" }, "text": { "en": "…" } }
    ]
  },
  "colors": { "light": { "accent": "#a63d78" }, "dark": { "accent": "#ec86b8" } }
}
```

### Text

- `appName`: shown in the header and the page titles. Up to 40 characters.
- `tagline`: shown on the landing page and used as the search description.
- `landing.title` and `landing.intro`: the headline and paragraph on the landing page.
- `landing.features`: one to four cards, each with an `icon`, a `title` and a `text`.

Every text field is an object keyed by language (`en`, `de`, `tr`). **`en` is required.** A missing language falls back to English.

Icons: `lock`, `users`, `link`, `gift`, `sparkles`, `heart`, `list`, `shield`.

### Colours

`colors.light` and `colors.dark` each take any of the 30 tokens below. Values must be hex colours such as `#a63d78` or `#abc`. Anything else is rejected at startup, so nothing unsafe can reach the stylesheet. Leave a token out to keep its built-in colour. The shipped `site.json` lists every token with its default value, so you can start from it.

| Token | Used for |
| --- | --- |
| `background`, `backgroundAccent` | page background and its soft gradient |
| `surface`, `surfaceSoft`, `surfaceStrong` | cards, inputs, raised areas |
| `text`, `textSoft`, `textFaint` | headings, body text, hints |
| `line`, `lineStrong` | borders and dividers |
| `accent`, `accentStrong`, `accentSoft`, `accentInk` | buttons, links, chips, highlights |
| `secondary`, `secondarySoft` | focus rings, secondary buttons |
| `success`, `successSoft`, `danger`, `dangerSoft` | notices and destructive actions |
| `star`, `avatarBlob` | priority hearts, avatar backdrop |
| `tone0` … `tone7` | list cover colours |

The colours are served from `/theme-tokens.css`, a separate stylesheet. Inline styles are not used, so the strict content security policy stays in place.

Check that text stays readable on its background after you change colours. The app does not check contrast for you.

## Campaign bar

Admins can show one short message above the content on the home and lists pages. Turn it on or off in **Admin → Campaign bar** and keep it to 200 characters, for example:

> Only 4 days left to Christmas! 🎄

The message is stored in the database rather than in `site.json`, so it can be changed without a restart. It is shown in the language the admin writes it in.

## Languages

The interface ships in English, German and Turkish. The language picker is in the account menu in the header. Adding a language means: a catalogue in `src/i18n/` with the same keys as `en.json` (the test suite fails if they differ), the code added to `LOCALES` and the `Locale` type in `src/lib/i18n.ts`, and an option in the language picker in `src/views/layout.tsx`. For site copy, add the language to the text objects in `site.json`.
