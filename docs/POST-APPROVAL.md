# Miratimi dhe kalendari pa Meta

Miratimi dhe ruajtja e postimeve në kalendar janë të pavarura nga lidhjet me Facebook/Instagram. Kontrollet e tekstit, fotografisë dhe të drejtave, konfirmimi manual i përdoruesit dhe shërbimi aktiv mbeten të nevojshme.

- `POST /api/posts/:id/validate` me `{ "scope": "content" }` (parazgjedhja) kontrollon përmbajtjen pa kërkesa te Meta. Kontrolli i suksesshëm vlen 5 minuta për miratim dhe lidhet me përmbajtjen e ruajtur.
- `publicationMode: "manual"` është parazgjedhja e kalendarit. Orari ruhet në PostgreSQL dhe nuk krijohet `publication_job`, edhe nëse Meta lidhet më vonë. Data mund të jetë pas përfundimit të trial-it sepse është vetëm planifikim.
- `publicationMode: "automatic"` kërkon zgjedhje të qartë nga përdoruesi, kontroll të suksesshëm me `scope: "publication"`, të drejtë publikimi, worker aktiv dhe lidhje të vlefshme Meta. Kontrolli vetëm i përmbajtjes nuk autorizon publikim.
- Ndryshimi i mënyrës/orarit kërkon heqjen nga kalendari dhe planifikimin sërish. Shkëputja e Meta-s anulon publikimet automatike në pritje dhe ruan oraret për organizim manual; publikimet me përgjigje të paqartë mbeten të bllokuara për verifikim.
- Dështimi i kontrollit Meta nuk shënon përmbajtjen si të pavlefshme dhe nuk ndryshon miratimin e saj.

Migrimi `0007_optional_meta_calendar.sql` cakton mënyrën për postimet ekzistuese: ruan si automatike ato që kanë tashmë punë publikimi aktive ose të përfunduar për versionin aktual; të tjerat bëhen manuale. Migrimet ekzekutohen me `npm run db:migrate`.

Publikimi real në rrjete sociale kërkon ende konfigurimin e aplikacionit Meta dhe autorizimin e biznesit. Ruajtja në kalendar nuk do të thotë që postimi është publikuar.
