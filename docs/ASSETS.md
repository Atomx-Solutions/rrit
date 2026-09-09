# Asset provenance

The sample brand "Mulliri i Lagjes" and user "Arbër Demo" exist only in automated test fixtures. They are never a runtime fallback and do not establish facts about a real business.

Locally downloaded illustrative photographs from Unsplash image delivery:

- `coffee.jpg`: photo-1447933601403-0c6688de566e
- `interior.jpg`: photo-1554118811-1e0d58224f24
- `pastry.jpg`: photo-1509440159596-0249088772ff
- `table.jpg`: photo-1495474472287-4d71bcdd2085
- `burger.jpg`: photo-1568901346375-23c9450c58cd; downloaded from `https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=85` for the illustrative restaurant poster.

`tennis-court.jpg` is a real aerial photograph by Frank Schrader, downloaded from [Pexels — Drone Shot of a Tennis Court](https://www.pexels.com/photo/drone-shot-of-a-tennis-court-11513316/) under the [Pexels license](https://www.pexels.com/license/). Local delivery source: `https://images.pexels.com/photos/11513316/pexels-photo-11513316.jpeg?auto=compress&cs=tinysrgb&w=1000`. It was used in an earlier tennis revision and is no longer loaded by the current landing.

`tennis-ball-court.jpg` is a real photograph by Ahmed, downloaded from [Pexels — Ball on a Tennis Court](https://www.pexels.com/photo/ball-on-a-tennis-court-22775592/) under the Pexels license. Local delivery source: `https://images.pexels.com/photos/22775592/pexels-photo-22775592.jpeg?auto=compress&cs=tinysrgb&w=1000`. The current tennis scene uses this original photograph, including its actual ball, shadow and court surface, with a soft CSS mask blending into the page. Albanian typography and a brief simulated publishing confirmation are HTML/CSS overlays, not live AI output or a real customer post.

The rejected illustrated tennis artwork, its `tennis-post.png` export and its rendering script were removed. The current scene uses the credited original photograph directly; there is no generated tennis bitmap or synthetic court.

The runtime asset library accepts each business's own media and records its rights declaration. These test assets are not eligible for real publishing or production seed data. Production release still requires the documented consent, provenance and retention lifecycle.

Inter Variable is bundled from `@fontsource-variable/inter`; Lucide icons from `@iconify-json/lucide`. Refer to their package license files for redistribution terms. The simple Rrit SVG mark is authored for this frontend.

The 2026-09-06 identity consists of `public/logo.svg`, `public/logo-light.svg` and `public/favicon.svg`. The lowercase geometric wordmark and monogram are original vector paths. Their backgrounds are transparent; the wordmarks do not depend on installed fonts. The light variant is used on dark surfaces. These assets were drawn in SVG, not generated as raster images.

The revised 2026-09-08 landing uses the locally bundled `table.jpg`, `burger.jpg` and `interior.jpg` in three original HTML/CSS post compositions. Their photographs are real; the compositions, business labels, location and Albanian headlines are illustrative marketing examples, not real Rrit customers, testimonials or output from the post generator. The 3D arrangement, orbital rings and sphere are CSS, with no generated bitmap asset. See [LANDING-PAGE.md](LANDING-PAGE.md) for design references and motion behavior.
